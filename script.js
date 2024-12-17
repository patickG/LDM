document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const combineBtn = document.getElementById('combineBtn');
    const prompt1Input = document.getElementById('prompt1');
    const prompt2Input = document.getElementById('prompt2');
    const preview1 = document.getElementById('preview1');
    const preview2 = document.getElementById('preview2');
    const resultPreview = document.getElementById('resultPreview');

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

            const response = await fetch('/generate/', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            // 显示生成的图片
            preview1.innerHTML = `<img src="${data.image_urls[0]}" alt="结构图">`;
            preview2.innerHTML = `<img src="${data.image_urls[1]}" alt="特征图">`;

            hideLoadingState(preview1);
            hideLoadingState(preview2);
            
            // 启用合成按钮
            combineBtn.disabled = false;
        } catch (error) {
            console.error('生成图片失败:', error);
            alert('生成图片失败，请重试');
            hideLoadingState(preview1);
            hideLoadingState(preview2);
        }
    });

    // 合成图片
    combineBtn.addEventListener('click', async () => {
        try {
            showLoadingState(resultPreview);

            const response = await fetch('/combine/', {
                method: 'POST'
            });

            const data = await response.text();
            resultPreview.innerHTML = data;

            hideLoadingState(resultPreview);
        } catch (error) {
            console.error('合成图片失败:', error);
            alert('合成图片失败，请重试');
            hideLoadingState(resultPreview);
        }
    });

    // 显示加载状态
    function showLoadingState(element) {
        element.classList.add('loading');
        element.innerHTML = '<div class="loading-spinner"></div>';
    }

    // 隐藏加载状态
    function hideLoadingState(element) {
        element.classList.remove('loading');
    }
}); 