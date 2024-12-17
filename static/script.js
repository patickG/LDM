// 全局变量和函数
let currentSelectorTarget = null;
let selectedPreviewId = null;

// 打开图片选择器
function openImageSelector(type, previewId) {
    currentSelectorTarget = type;
    selectedPreviewId = previewId;
    const modal = document.getElementById('imageSelectorModal');
    const grid = document.getElementById('selectorGrid');
    
    try {
        fetch(`/api/images/${type}`)
            .then(response => response.json())
            .then(data => {
                if (data.images && data.images.length > 0) {
                    grid.innerHTML = data.images.map(image => `
                        <div class="image-grid-item" onclick="selectImage('${image.url}')">
                            <img src="${image.url}" alt="${type}">
                        </div>
                    `).join('');
                } else {
                    grid.innerHTML = '<p>没有可用的图片</p>';
                }
                
                modal.style.display = 'block';
            });
    } catch (error) {
        console.error('加载图片失败:', error);
        alert('加载图片失败，请重��');
    }
}

// 选择图片
function selectImage(url) {
    const preview = document.getElementById(selectedPreviewId);
    preview.innerHTML = `<img src="${url}" alt="选中的图片">`;
    closeImageSelector();
    
    // 检查并启用合成按钮
    checkAndEnableCombineButton();
}

// 关闭图片选择器
function closeImageSelector() {
    const modal = document.getElementById('imageSelectorModal');
    modal.style.display = 'none';
}

// 上传图片
async function uploadImage(input, type) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (data.success) {
                // 显示上传的图片
                const previewId = type === 'structure' ? 'preview1' : 'preview2';
                document.getElementById(previewId).innerHTML = `<img src="${data.image_url}" alt="${type}图">`;
                // 检查并启用合成按钮
                checkAndEnableCombineButton();
            } else {
                alert(data.message || '���传失败');
            }
        } catch (error) {
            console.error('上传图片失败:', error);
            alert('上传图片失败，请重试');
        }
    }
}

// 生成图片
async function generateImage(type) {
    const promptInput = type === 'structure' ? document.getElementById('prompt1') : document.getElementById('prompt2');
    const previewElement = type === 'structure' ? document.getElementById('preview1') : document.getElementById('preview2');
    
    if (!promptInput.value) {
        alert('请输入生成要求');
        return;
    }

    try {
        showLoadingState(previewElement);

        const formData = new FormData();
        formData.append('prompt', promptInput.value);
        formData.append('type', type);

        const response = await fetch('/generate', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        
        if (data.success && data.progress_id) {
            // 创建进度显示元素
            const progressElement = document.createElement('div');
            progressElement.className = 'generation-progress';
            progressElement.innerHTML = `
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
                <div class="progress-text">正在生成: 0%</div>
            `;
            previewElement.appendChild(progressElement);

            // 建立SSE连接来接收进度更新
            const eventSource = new EventSource(`/progress/${data.progress_id}`);
            
            eventSource.onmessage = (event) => {
                const progressData = JSON.parse(event.data);
                
                if (progressData.status === 'done') {
                    eventSource.close();
                    // 显示生成的图片
                    if (progressData.image_url) {
                        previewElement.innerHTML = `<img src="${progressData.image_url}" alt="${type}图">`;
                    }
                    // 检查并启用合成按钮
                    checkAndEnableCombineButton();
                } else if (progressData.status === 'timeout') {
                    eventSource.close();
                    alert('生成超时，请重试');
                    hideLoadingState(previewElement);
                } else {
                    // 更新进度条
                    const progressFill = progressElement.querySelector('.progress-fill');
                    const progressText = progressElement.querySelector('.progress-text');
                    
                    if (progressData.progress) {
                        const progress = Math.min(100, Math.max(0, progressData.progress));
                        progressFill.style.width = `${progress}%`;
                        progressText.textContent = `正在生成: ${progress}%`;
                    }
                    
                    if (progressData.message) {
                        progressText.textContent = progressData.message;
                    }
                }
            };
            
            eventSource.onerror = (error) => {
                console.error('SSE连接错误:', error);
                eventSource.close();
                alert('生成过程中断，请重试');
                hideLoadingState(previewElement);
            };
            
        } else {
            alert(data.message || '生成图片失败');
            hideLoadingState(previewElement);
        }
    } catch (error) {
        console.error('生成图片失败:', error);
        alert('生成图片失败，请重试');
        hideLoadingState(previewElement);
    }
}

// 添加进度显示样式
const style = document.createElement('style');
style.textContent = `
.generation-progress {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: 80%;
    text-align: center;
}

.progress-bar {
    width: 100%;
    height: 4px;
    background: #ddd;
    border-radius: 2px;
    overflow: hidden;
}

.progress-fill {
    width: 0%;
    height: 100%;
    background: #4CAF50;
    transition: width 0.3s ease;
}

.progress-text {
    margin-top: 8px;
    font-size: 12px;
    color: #666;
}
`;
document.head.appendChild(style);

// DOM加载完成后的初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成');  // 调试日志
    
    const generateBtn = document.getElementById('generateBtn');
    const combineBtn = document.getElementById('combineBtn');
    const prompt1Input = document.getElementById('prompt1');
    const prompt2Input = document.getElementById('prompt2');
    const preview1 = document.getElementById('preview1');
    const preview2 = document.getElementById('preview2');
    const resultPreview = document.getElementById('resultPreview');

    console.log('合成按钮元素:', combineBtn);  // 调试日志
    
    if (!combineBtn) {
        console.error('找不到合成按钮元素!');
        return;
    }

    // 生成图片
    generateBtn.addEventListener('click', async () => {
        const prompt1 = prompt1Input.value;
        const prompt2 = prompt2Input.value;

        if (!prompt1 || !prompt2) {
            alert('请输入生成要求');
            return;
        }

        try {
            showLoadingState(preview1);
            showLoadingState(preview2);

            const formData = new FormData();
            formData.append('prompt1', prompt1);
            formData.append('prompt2', prompt2);

            const response = await fetch('/generate', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (response.ok) {
                preview1.innerHTML = `<img src="${data.image_urls[0]}" alt="结构图">`;
                preview2.innerHTML = `<img src="${data.image_urls[1]}" alt="特征图">`;
                combineBtn.disabled = false;
            } else {
                alert(data.message || '生成图片失败');
            }
        } catch (error) {
            console.error('生成图片失败:', error);
            alert('生成图片失败，请重试');
        } finally {
            hideLoadingState(preview1);
            hideLoadingState(preview2);
        }
    });

    // 合成图片
    combineBtn.addEventListener('click', async () => {
        console.log('合成按钮被点击 - 事件处理开始');  // 调试日志
        
        // 检查按钮状态
        console.log('按钮状态:', {
            disabled: combineBtn.disabled,
            classList: Array.from(combineBtn.classList)
        });
        
        try {
            showLoadingState(resultPreview);

            // 获取当前显示的图片路径
            const structureImg = document.querySelector('#preview1 img');
            const featureImg = document.querySelector('#preview2 img');

            console.log('预览区域状态:');
            console.log('- 结构图元素:', structureImg);
            console.log('- 特征图元素:', featureImg);

            if (!structureImg || !featureImg) {
                console.log('错误: 图片元素未找到');
                alert('请确保两张图片都已选择');
                hideLoadingState(resultPreview);
                return;
            }

            console.log('图片路径:');
            console.log('- 结构图:', structureImg.src);
            console.log('- 特征图:', featureImg.src);

            // 从完整URL中提取相对路径
            const getRelativePath = (fullPath) => {
                const parts = fullPath.split('/static/');
                return parts.length > 1 ? '/static/' + parts[1] : fullPath;
            };

            const requestData = {
                structure_path: getRelativePath(structureImg.src),
                feature_path: getRelativePath(featureImg.src)
            };

            console.log('准备发送请求:');
            console.log('- URL: /combine');
            console.log('- 数据:', requestData);

            const response = await fetch('/combine', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            console.log('收到服务器响应:', response);
            console.log('响应状态:', response.status);
            
            const data = await response.json();
            console.log('响应数据:', data);

            if (data.success) {
                console.log('合成成功，显示结果图片:', data.image_url);
                resultPreview.innerHTML = `<img src="${data.image_url}" alt="合成结果">`;
            } else {
                console.error('合成失败:', data.message);
                alert(data.message || '合成失败');
            }

            hideLoadingState(resultPreview);
        } catch (error) {
            console.error('合成过程发生错误:', error);
            alert('合成图片失败，请重试');
            hideLoadingState(resultPreview);
        }
    });

    // 初始检查按钮状态
    checkAndEnableCombineButton();
    console.log('初始化完成');  // 调试日志

    // 点击模态框外部关闭
    window.onclick = function(event) {
        const modal = document.getElementById('imageSelectorModal');
        if (event.target == modal) {
            closeImageSelector();
        }
    }
});

// 辅助函数
function showLoadingState(element) {
    element.classList.add('loading');
    element.innerHTML = '<div class="loading-spinner"></div>';
}

function hideLoadingState(element) {
    element.classList.remove('loading');
}

// 检查并启用合成按钮
function checkAndEnableCombineButton() {
    console.log('检查合成按钮状态');  // 调试日志
    
    const preview1 = document.getElementById('preview1');
    const preview2 = document.getElementById('preview2');
    const combineBtn = document.getElementById('combineBtn');
    
    if (!preview1 || !preview2 || !combineBtn) {
        console.error('找不到必要的DOM元素:');
        console.error('- preview1:', preview1);
        console.error('- preview2:', preview2);
        console.error('- combineBtn:', combineBtn);
        return;
    }
    
    const hasStructureImage = preview1.querySelector('img') !== null;
    const hasFeatureImage = preview2.querySelector('img') !== null;
    
    console.log('预览区域状态:');
    console.log('- 结构图:', hasStructureImage ? '已选择' : '未选择');
    console.log('- 特征图:', hasFeatureImage ? '已选择' : '未选择');
    
    const shouldEnable = hasStructureImage && hasFeatureImage;
    combineBtn.disabled = !shouldEnable;
    
    console.log('合成按钮���态:', shouldEnable ? '已启用' : '已禁用');
    
    // 添加或移除视觉提示类
    if (shouldEnable) {
        combineBtn.classList.remove('disabled');
        combineBtn.classList.add('ready');
    } else {
        combineBtn.classList.add('disabled');
        combineBtn.classList.remove('ready');
    }
}

// 合成按钮点击处理函数
async function handleCombineClick() {
    console.log('合成按钮被点击 - 事件处理开始');
    const combineBtn = document.getElementById('combineBtn');
    const resultPreview = document.getElementById('resultPreview');
    
    // 检查按钮状态
    console.log('按钮状态:', {
        disabled: combineBtn.disabled,
        classList: Array.from(combineBtn.classList)
    });
    
    try {
        showLoadingState(resultPreview);

        // 获取当前显示的图片路径
        const structureImg = document.querySelector('#preview1 img');
        const featureImg = document.querySelector('#preview2 img');

        console.log('预览区域状态:');
        console.log('- 结构图元素:', structureImg);
        console.log('- 特征图元素:', featureImg);

        if (!structureImg || !featureImg) {
            console.log('错误: 图片元素未找到');
            alert('请确保两张图片都已选择');
            hideLoadingState(resultPreview);
            return;
        }

        console.log('图片路径:');
        console.log('- 结构图:', structureImg.src);
        console.log('- 特征图:', featureImg.src);

        // 从完整URL中提取相对路径
        const getRelativePath = (fullPath) => {
            const parts = fullPath.split('/static/');
            return parts.length > 1 ? '/static/' + parts[1] : fullPath;
        };

        const requestData = {
            structure_path: getRelativePath(structureImg.src),
            feature_path: getRelativePath(featureImg.src)
        };

        console.log('准备发送请求:');
        console.log('- URL: /combine');
        console.log('- 数据:', requestData);

        const response = await fetch('/combine', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        console.log('收到服务器响应:', response);
        console.log('响应状态:', response.status);
        
        const data = await response.json();
        console.log('响应数据:', data);

        if (data.success) {
            console.log('合成成功，显示结果图片:', data.image_url);
            resultPreview.innerHTML = `<img src="${data.image_url}" alt="合成结果">`;
        } else {
            console.error('合成失败:', data.message);
            alert(data.message || '合成失败');
        }

        hideLoadingState(resultPreview);
    } catch (error) {
        console.error('合成过程发生错误:', error);
        alert('合成图片失败，请重试');
        hideLoadingState(resultPreview);
    }
} 