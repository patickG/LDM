from flask import Flask, request, jsonify, send_file, render_template, redirect, url_for, session, send_from_directory, Response
from flask_cors import CORS
import os
import subprocess
from datetime import datetime
from functools import wraps
import json
import shutil
from werkzeug.utils import secure_filename
import time
import queue
import sys

app = Flask(__name__, static_url_path='/static', static_folder='static')
CORS(app)

# 添加 session 密钥
app.secret_key = 'your-secret-key-123'  # 请更改为随机的密钥

# 配置不同类型图片的存储目录
app.config.update(
    STRUCTURE_FOLDER='static/generated_images/structure',  # 结构图文件夹
    FEATURE_FOLDER='static/generated_images/feature',      # 特征图文件夹
    COMBINED_FOLDER='static/generated_images/combined',    # 合成图文件夹
    MAX_CONTENT_LENGTH=16 * 1024 * 1024
)

# 确保所有必要的目录存在
for folder in [app.config['STRUCTURE_FOLDER'], 
               app.config['FEATURE_FOLDER'], 
               app.config['COMBINED_FOLDER']]:
    if not os.path.exists(folder):
        os.makedirs(folder)

# 登录验证装饰器
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# 登录页面路由
@app.route('/login', methods=['GET'])
def login():
    if 'username' in session:
        return redirect(url_for('main'))
    return render_template('login.html')

# 登录处理路由
@app.route('/login', methods=['POST'])
def login_post():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    # 验证用户名和密码
    if username == 'GH' and password == '12345':
        session['username'] = username
        return jsonify({'message': '登录成功'})
    else:
        return jsonify({'message': '用户名或密码错误'}), 401

# 主页面路由（需要登录）
@app.route('/main')
@login_required
def main():
    return render_template('index.html')

# 注销路由
@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('login'))

# 修改原来的根路由
@app.route('/')
def index():
    if 'username' not in session:
        return redirect(url_for('login'))
    return redirect(url_for('main'))

# 全局进度队列
progress_queues = {}

def generate_progress_id():
    return str(int(time.time() * 1000))

@app.route('/progress/<progress_id>')
def progress(progress_id):
    def generate():
        if progress_id not in progress_queues:
            progress_queues[progress_id] = queue.Queue()
        q = progress_queues[progress_id]
        
        while True:
            try:
                progress_data = q.get(timeout=30)  # 30秒超时
                if progress_data == "DONE":
                    yield f"data: {json.dumps({'status': 'done'})}\n\n"
                    break
                yield f"data: {json.dumps(progress_data)}\n\n"
            except queue.Empty:
                yield f"data: {json.dumps({'status': 'timeout'})}\n\n"
                break
                
        # 清理队列
        if progress_id in progress_queues:
            del progress_queues[progress_id]
            
    return Response(generate(), mimetype='text/event-stream')

# 生成图片接口
@app.route('/generate', methods=['POST'])
def generate():
    try:
        prompt = request.form.get('prompt')
        type = request.form.get('type')
        
        if not prompt or not type:
            return jsonify({'success': False, 'message': '缺少必要参数'})
            
        # 确定输出目录
        if type == 'structure':
            output_dir = app.config['STRUCTURE_FOLDER']
        else:
            output_dir = app.config['FEATURE_FOLDER']
            
        # 生成进度ID
        progress_id = generate_progress_id()
        progress_queue = queue.Queue()
        progress_queues[progress_id] = progress_queue
        
        try:
            # 设置工作目录路径
            base_dir = os.path.abspath(os.path.dirname(__file__))
            latent_diffusion_dir = os.path.join(base_dir, "latent-diffusion-main")
            
            # 保存当前工作目录
            original_dir = os.getcwd()
            print(f"原始工作目录: {original_dir}")
            
            # 切换到latent-diffusion-main目录
            os.chdir(latent_diffusion_dir)
            print(f"切换到工作目录: {os.getcwd()}")
            
            # 构建命令
            command = [
                "python",
                "scripts/txt2img.py",
                "--prompt", prompt,
                "--outdir", os.path.abspath(output_dir),
                "--ddim_eta", "0.0",
                "--n_samples", "1",
                "--n_iter", "1",
                "--scale", "5.0",
                "--ddim_steps", "50"
            ]
            
            print("执行命令:", " ".join(command))
            
            # 在新线程中执行命令
            def generate_thread():
                try:
                    progress_queue.put({
                        'progress': 0,
                        'message': '正在初始化...'
                    })
                    
                    # 设置环境变量强制使用CPU
                    env = os.environ.copy()
                    env["CUDA_VISIBLE_DEVICES"] = ""  # 禁用CUDA
                    
                    # 执行命令
                    result = subprocess.run(
                        command,
                        check=True,
                        capture_output=True,
                        text=True,
                        cwd=latent_diffusion_dir,
                        env=env  # 使用修改后的环境变量
                    )
                    
                    print("命令输出:", result.stdout)
                    if result.stderr:
                        print("命令错误:", result.stderr)
                    
                    # 获取生成的最新图片
                    image_files = sorted(os.listdir(output_dir))
                    if image_files:
                        latest_image = image_files[-1]
                        image_url = f'/static/generated_images/{type}/{latest_image}'
                        
                        # 发送完成消息
                        progress_queue.put({
                            'status': 'done',
                            'image_url': image_url
                        })
                    else:
                        progress_queue.put({
                            'status': 'error',
                            'message': '生成图片失败：未找到输出文件'
                        })
                except subprocess.CalledProcessError as e:
                    print(f"命令执行失败: {e.stderr}")
                    progress_queue.put({
                        'status': 'error',
                        'message': f'生成图片失败: {e.stderr}'
                    })
                except Exception as e:
                    print(f"生成过程错误: {str(e)}")
                    progress_queue.put({
                        'status': 'error',
                        'message': f'生成图片失败: {str(e)}'
                    })
                finally:
                    # 恢复原始工作目录
                    os.chdir(original_dir)
                    print(f"恢复到原始工作目录: {os.getcwd()}")
            
            # 启动生成线程
            import threading
            thread = threading.Thread(target=generate_thread)
            thread.daemon = True
            thread.start()
            
            return jsonify({
                'success': True,
                'progress_id': progress_id,
                'message': '开始生成图片'
            })
            
        except Exception as e:
            print(f"启动生成过程失败: {str(e)}")
            # 确保恢复原始工作目录
            if 'original_dir' in locals():
                os.chdir(original_dir)
                print(f"错误后恢复到原始工作目录: {os.getcwd()}")
            if progress_id in progress_queues:
                del progress_queues[progress_id]
            return jsonify({'success': False, 'message': f'启动生成过程失败: {str(e)}'})
        
    except Exception as e:
        print(f"生成图片接口错误: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})

# 合成图片接口
@app.route('/combine', methods=['POST'])
def combine_images():
    print("\n=== 开始处理合成请求 ===")
    try:
        data = request.get_json()
        print("收到的数据:", data)
        
        if not data:
            print("错误: 无效的请求数据")
            return jsonify({'message': '无效的请求数据'}), 400

        structure_url = data.get('structure_path')
        feature_url = data.get('feature_path')
        
        print("结构图URL:", structure_url)
        print("特征图URL:", feature_url)

        if not structure_url or not feature_url:
            print("错误: 缺少图片路径")
            return jsonify({'message': '请先选择结构图和特征图'}), 400

        # 从URL中提取文件名
        structure_file = os.path.basename(structure_url.split('/')[-1])
        feature_file = os.path.basename(feature_url.split('/')[-1])
        
        print("结构图文件名:", structure_file)
        print("特征图文件名:", feature_file)

        # 构建完整的绝对文件路径
        base_dir = os.path.abspath(os.path.dirname(__file__))
        structure_path = os.path.join(base_dir, app.config['STRUCTURE_FOLDER'], structure_file)
        feature_path = os.path.join(base_dir, app.config['FEATURE_FOLDER'], feature_file)
        
        print("结构图完整路径:", structure_path)
        print("特征图完整路径:", feature_path)
        print("文件否存在:")
        print(f"- 结构图: {os.path.exists(structure_path)}")
        print(f"- 特征图: {os.path.exists(feature_path)}")

        # 确保路径存在
        if not os.path.exists(structure_path) or not os.path.exists(feature_path):
            print("错误: 找不到图片文件")
            return jsonify({'message': '找不到选择的图片文件'}), 404

        # 生成输出文件名和完整路径
        structure_name = os.path.splitext(structure_file)[0]
        feature_name = os.path.splitext(feature_file)[0]
        output_name = f'{structure_name}_stylized_{feature_name}.jpg'
        
        # 直接在combined目录下保存文件
        combined_dir = os.path.join(base_dir, 'static', 'generated_images', 'combined')
        output_path = os.path.join(combined_dir, output_name)
        
        print("输出文件信息:")
        print(f"- 文件名: {output_name}")
        print(f"- 完整路径: {output_path}")

        # 确保combined目录存在
        os.makedirs(combined_dir, exist_ok=True)

        try:
            # 获取AdaIN目录的绝对路径（注意是嵌套的目录）
            adain_dir = os.path.join(base_dir, 'pytorch-AdaIN-master', 'pytorch-AdaIN-master')
            print("\n=== 准备执行合��命令 ===")
            print("工作目录:", adain_dir)
            print("工作目录是否存在:", os.path.exists(adain_dir))
            
            # 检查模型文件
            vgg_path = os.path.join(adain_dir, 'models', 'vgg_normalised.pth')
            decoder_path = os.path.join(adain_dir, 'models', 'decoder.pth')
            print("检查模型文件:")
            print(f"- VGG模型: {os.path.exists(vgg_path)}")
            print(f"- 解码器模型: {os.path.exists(decoder_path)}")
            
            if not os.path.exists(vgg_path) or not os.path.exists(decoder_path):
                return jsonify({'message': '模型文件不存在'}), 500
            
            # 构建命令参数列表
            command = [
                'python',
                os.path.join(adain_dir, 'test.py'),
                '--content', structure_path,
                '--style', feature_path,
                '--output', combined_dir,
                '--alpha', '1.0',
                '--vgg', vgg_path,
                '--decoder', decoder_path
            ]
            
            print("执行命令:", ' '.join(command))
            
            # 在AdaIN目录中执行命令
            result = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                cwd=adain_dir
            )

            print("\n=== 命令执行结果 ===")
            if result.stdout:
                print("标准输出:", result.stdout)
            if result.stderr:
                print("错误输出:", result.stderr)

            # 检查输出文件
            expected_output = os.path.join(combined_dir, f'{structure_name}_stylized_{feature_name}.jpg')
            if not os.path.exists(expected_output):
                print("错误: 输出文件未生成")
                print(f"预期文件路径: {expected_output}")
                return jsonify({'message': '合成失败：未生成输出文件'}), 500

            # 构建用于显示的URL路径
            url_path = f'/static/generated_images/combined/{output_name}'
            print("\n=== 合成完成 ===")
            print(f"URL路径: {url_path}")

            # 返回成功信息和图片URL
            return jsonify({
                'success': True,
                'message': '合成成功',
                'image_url': url_path
            })

        except subprocess.CalledProcessError as e:
            print(f"\n=== 命令执行失败 ===")
            print(f"错误信息: {e.stderr}")
            return jsonify({
                'success': False,
                'message': f'合成命令执行失败: {e.stderr}'
            }), 500

    except Exception as e:
        print(f"\n=== 发生异常 ===")
        print(f"错误类型: {type(e)}")
        print(f"错误信息: {str(e)}")
        import traceback
        print(f"错误堆栈: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'message': f'合成图片时发生错误: {str(e)}'
        }), 500

# 获取图片列表的APIg
@app.route('/api/images/<type>')
@login_required
def get_images(type):
    try:
        if type == 'structure':
            folder = app.config['STRUCTURE_FOLDER']
        elif type == 'feature':
            folder = app.config['FEATURE_FOLDER']
        elif type == 'combined':
            folder = app.config['COMBINED_FOLDER']
        else:
            return jsonify({'message': '无效的图片类型'}), 400

        images = []
        # 支持多种图片格式
        valid_extensions = ('.jpg', '.jpeg', '.png', '.gif')
        
        for filename in sorted(os.listdir(folder), reverse=True):
            if filename.lower().endswith(valid_extensions):
                # 处理没有下划线的文件名
                try:
                    timestamp = filename.split('_')[1].split('.')[0]
                    formatted_time = f"{timestamp[:4]}-{timestamp[4:6]}-{timestamp[6:8]} {timestamp[8:10]}:{timestamp[10:12]}:{timestamp[12:14]}"
                except:
                    # 如果文件名格式不符合预期，使用文件修改时间
                    file_path = os.path.join(folder, filename)
                    timestamp = datetime.fromtimestamp(os.path.getmtime(file_path))
                    formatted_time = timestamp.strftime("%Y-%m-%d %H:%M:%S")

                if type == 'structure':
                    url = f'/static/generated_images/structure/{filename}'
                elif type == 'feature':
                    url = f'/static/generated_images/feature/{filename}'
                else:
                    url = f'/static/generated_images/combined/{filename}'
                    
                images.append({
                    'url': url,
                    'timestamp': formatted_time,
                    'type': type
                })

        print(f"Found {len(images)} images for type {type}")
        for img in images:
            print(f"Image URL: {img['url']}")
            
        return jsonify({'images': images})

    except Exception as e:
        print(f"Error in get_images: {str(e)}")
        return jsonify({'message': f'获取图片列表失败: {str(e)}'}), 500

# 图片库页面路由
@app.route('/gallery')
@login_required
def gallery():
    return render_template('gallery.html')

# 用启动时检路径
def check_paths():
    for folder in [app.config['STRUCTURE_FOLDER'], 
                   app.config['FEATURE_FOLDER'], 
                   app.config['COMBINED_FOLDER']]:
        abs_path = os.path.abspath(folder)
        print(f"Checking path: {abs_path}")
        if os.path.exists(abs_path):
            print(f"Path exists: {abs_path}")
            print(f"Contents: {os.listdir(abs_path)}")
        else:
            print(f"Path does not exist: {abs_path}")

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '没有上传文件'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'message': '没有选择文件'}), 400
        
        # 获取上传类型（结构图或特征图）
        image_type = request.form.get('type')
        if image_type not in ['structure', 'feature']:
            return jsonify({'success': False, 'message': '无效的图片类型'}), 400
        
        # 确定保存目录
        if image_type == 'structure':
            save_dir = app.config['STRUCTURE_FOLDER']
        else:
            save_dir = app.config['FEATURE_FOLDER']
        
        # 确保文件名安全
        filename = secure_filename(file.filename)
        # 生成唯一文件名
        base, ext = os.path.splitext(filename)
        filename = f"{base}_{int(time.time())}{ext}"
        
        # 保存文件
        file_path = os.path.join(save_dir, filename)
        file.save(file_path)
        
        # 返回图片URL
        image_url = f'/static/generated_images/{image_type}/{filename}'
        
        return jsonify({
            'success': True,
            'message': '上传成功',
            'image_url': image_url
        })
        
    except Exception as e:
        print(f"上传图片时发生错误: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'上传图片时发生错误: {str(e)}'
        }), 500

if __name__ == '__main__':
    with app.app_context():
        check_paths()
    print("应用已启动！")
    print("您可以通过以下地址访问：")
    print("本地访问: http://localhost:5000")
    print("局域网访问: http://192.168.80.1:5000")
    # 设置主机为0.0.0.0，允许外部访问，端口设为5000
    app.run(host='0.0.0.0', port=5000, debug=True) 