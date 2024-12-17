document.addEventListener('DOMContentLoaded', () => {
    const imageList = document.getElementById('imageList');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const closeBtn = document.querySelector('.close-btn');

    // 加载指定类型的图片
    async function loadImages(type) {
        try {
            console.log(`Loading images for type: ${type}`);  // 添加调试日志
            const response = await fetch(`/api/images/${type}`);
            const data = await response.json();
            
            console.log('Received data:', data);  // 添加调试日志
            
            if (data.images && data.images.length > 0) {
                imageList.innerHTML = data.images.map(image => `
                    <div class="gallery-item">
                        <img src="${image.url}" alt="${image.type}">
                        <div class="info">
                            <div class="timestamp">${image.timestamp}</div>
                        </div>
                    </div>
                `).join('');

                // 添加点击事件以预览图片
                document.querySelectorAll('.gallery-item').forEach(item => {
                    const img = item.querySelector('img');
                    item.addEventListener('click', () => {
                        modalImage.src = img.src;
                        modal.style.display = 'block';
                    });
                });
            } else {
                imageList.innerHTML = '<p class="no-images">暂无图片</p>';
            }
        } catch (error) {
            console.error('加载图片失败:', error);
            imageList.innerHTML = '<p class="error">加载图片失败，请重试</p>';
        }
    }

    // 标签切换事件
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            loadImages(button.dataset.type);
        });
    });

    // 关闭模态框
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // 初始加载结构图
    loadImages('structure');
}); 