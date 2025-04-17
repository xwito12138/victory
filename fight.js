// Game state
let playerHealth = 20;
let enemyHealth = 20;
let isPlayerAttacking = false;
let playerPosition = 0;
const PLAYER_SPEED = 12;
const DETECTION_INTERVAL = 50;
let lastJumpTime = 0; // 记录上次跳跃时间
let isJumping = false; // 是否正在跳跃
let isDoubleJumping = false; // 是否正在二段跳
let lastHandPositions = []; // 记录上一帧的手位置
let lastHandSizes = []; // 记录上一帧的手大小
let handSizeHistory = []; // 记录手大小的历史数据
const HAND_HISTORY_LENGTH = 5; // 历史数据长度
let isRageMode = false;
let rageModeCount = 0;

// 控制模式
let controlMode = 'keyboard'; // 'keyboard' 或 'camera'

// 子弹反弹次数限制
const MAX_BOUNCES = 2;

// 添加游戏状态变量
let isPlayerFrozen = false;

// Initialize camera and hand detection
async function setupCamera() {
    try {
        const video = document.getElementById('video');
        
        // 先尝试停止现有的视频流
        if (video.srcObject) {
            const tracks = video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            video.srcObject = null;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            } 
        });

        video.srcObject = stream;
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve(video);
            };
        });
    } catch (error) {
        console.error('Error accessing camera:', error);
        
        if (error.name === 'NotReadableError') {
            alert('摄像头设备正在被其他程序使用，请关闭其他可能使用摄像头的程序后刷新页面重试。');
        } else if (error.name === 'NotAllowedError') {
            alert('请允许使用摄像头权限。');
        } else {
            alert('无法访问摄像头，请确保摄像头设备正常工作。');
        }
        throw error;
    }
}

// 初始化手势识别
let hands;
async function setupHandDetection() {
    try {
        hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });
        
        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 0,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        hands.onResults(onHandResults);
        
        // 测试手势识别是否正常工作
        const video = document.getElementById('video');
        if (video.videoWidth && video.videoHeight) {
            await hands.send({image: video});
        }
    } catch (error) {
        console.error('Error setting up hand detection:', error);
        throw error;
    }
}

// 处理手势识别结果
function onHandResults(results) {
    if (!results.multiHandLandmarks) return;
    
    let moveLeft = false;
    let moveRight = false;
    let shootDirection = null;
    let shouldJump = false;
    
    // 获取当前帧的手位置和大小
    const currentHandPositions = [];
    const currentHandSizes = [];
    
    // 处理移动控制和射击控制
    results.multiHandLandmarks.forEach((landmarks, index) => {
        // 获取手掌中心点
        const palmCenter = {
            x: landmarks[0].x,
            y: landmarks[0].y
        };
        
        // 计算手的大小（使用手掌宽度作为参考）
        const handWidth = Math.abs(landmarks[5].x - landmarks[17].x);
        const handHeight = Math.abs(landmarks[0].y - landmarks[9].y);
        const handSize = handWidth * handHeight;
        
        // 记录当前手位置和大小
        currentHandPositions.push({
            x: palmCenter.x,
            y: palmCenter.y
        });
        
        currentHandSizes.push(handSize);
        
        // 检查手是否在底部区域（移动控制）
        if (palmCenter.y > 0.7) { // 底部30%的区域
            if (palmCenter.x < 0.3) { // 左侧30%的区域
                moveRight = true;  // 改为向右移动
            } else if (palmCenter.x > 0.7) { // 右侧30%的区域
                moveLeft = true;   // 改为向左移动
            }
        }
        
        // 检查手是否在上半部分（射击控制）
        if (palmCenter.y < 0.5) { // 上半部分
            // 检查是否触碰到方向按钮
            const direction = checkDirectionButtonTouch(palmCenter);
            if (direction) {
                shootDirection = direction;
            }
        }
        
        // 检查手是否与跳跃按钮重叠
        if (checkJumpButtonTouch(palmCenter)) {
            shouldJump = true;
        }
    });
    
    // 更新手大小历史数据
    if (currentHandSizes.length > 0) {
        handSizeHistory.push([...currentHandSizes]);
        if (handSizeHistory.length > HAND_HISTORY_LENGTH) {
            handSizeHistory.shift();
        }
    }
    
    // 检测双手拍击（跳跃）- 只有当两只手都在摄像头内时检测
    if (currentHandPositions.length === 2 && handSizeHistory.length >= 3) {
        // 检查手大小变化趋势
        const recentSizes = handSizeHistory.slice(-3);
        const sizeChanges = [];
        
        // 计算每只手的大小变化
        for (let i = 0; i < 2; i++) {
            const currentSize = currentHandSizes[i];
            const previousSizes = recentSizes.map(frame => frame[i] || 0).filter(size => size > 0);
            
            if (previousSizes.length > 0) {
                // 计算平均变化率
                const avgPreviousSize = previousSizes.reduce((sum, size) => sum + size, 0) / previousSizes.length;
                const changeRate = currentSize / avgPreviousSize;
                sizeChanges.push(changeRate);
            }
        }
        
        // 如果两只手的大小都发生了剧烈变化（拍击动作）
        if (sizeChanges.length === 2 && 
            ((sizeChanges[0] > 1.3 || sizeChanges[0] < 0.7) && 
             (sizeChanges[1] > 1.3 || sizeChanges[1] < 0.7))) {
            handleJump();
        }
    }
    
    // 更新上一帧的手位置和大小
    lastHandPositions = currentHandPositions;
    lastHandSizes = currentHandSizes;
    
    // 更新玩家位置
    if (moveLeft) {
        playerPosition = Math.max(playerPosition - PLAYER_SPEED, -window.innerWidth / 2);
    }
    if (moveRight) {
        playerPosition = Math.min(playerPosition + PLAYER_SPEED, window.innerWidth / 2);
    }
    
    // 触发射击（发射两枚子弹）
    if (shootDirection && !isPlayerAttacking) {
        shootPlayerBullet(shootDirection);
        // 延迟100ms发射第二枚子弹
        setTimeout(() => {
            shootPlayerBullet(shootDirection);
        }, 100);
    }
    
    // 触发跳跃
    if (shouldJump) {
        handleJump();
    }
    
    // 更新玩家位置 - 确保在跳跃前更新位置
    updatePlayerPosition();
}

// 检查是否触碰到方向按钮
function checkDirectionButtonTouch(palmCenter) {
    // 获取所有方向按钮
    const buttons = document.querySelectorAll('.direction-button');
    
    // 遍历按钮检查是否被触摸
    for (const button of buttons) {
        // 获取按钮在摄像头视图中的相对位置
        const buttonRect = button.getBoundingClientRect();
        const cameraContainer = document.querySelector('.camera-container');
        const cameraRect = cameraContainer.getBoundingClientRect();
        
        // 计算按钮在摄像头视图中的相对位置（0-1范围）
        // 由于视频是镜像的，我们需要将x坐标也镜像
        const buttonX = 1 - (buttonRect.left + buttonRect.width/2 - cameraRect.left) / cameraRect.width;
        const buttonY = (buttonRect.top + buttonRect.height/2 - cameraRect.top) / cameraRect.height;
        
        // 计算手掌中心与按钮中心的距离
        const distance = Math.sqrt(
            Math.pow(palmCenter.x - buttonX, 2) + 
            Math.pow(palmCenter.y - buttonY, 2)
        );
        
        // 如果距离小于阈值，认为手与按钮重叠
        const threshold = 0.2; // 增加灵敏度，从0.15增加到0.2
        if (distance < threshold) {
            // 添加视觉反馈
            button.classList.add('active');
            setTimeout(() => button.classList.remove('active'), 200);
            
            // 创建浮动猫猫emoji
            createFloatingEmoji(button);
            
            // 返回按钮对应的方向
            return button.dataset.direction;
        }
    }
    
    return null;
}

// 检查是否触碰到跳跃按钮
function checkJumpButtonTouch(palmCenter) {
    // 获取跳跃按钮
    const button = document.querySelector('.jump-button');
    
    // 获取按钮在摄像头视图中的相对位置
    const buttonRect = button.getBoundingClientRect();
    const cameraContainer = document.querySelector('.camera-container');
    const cameraRect = cameraContainer.getBoundingClientRect();
    
    // 计算按钮在摄像头视图中的相对位置（0-1范围）
    const buttonX = (buttonRect.left + buttonRect.width/2 - cameraRect.left) / cameraRect.width;
    const buttonY = (buttonRect.top + buttonRect.height/2 - cameraRect.top) / cameraRect.height;
    
    // 计算手掌中心与按钮中心的距离
    const distance = Math.sqrt(
        Math.pow(palmCenter.x - buttonX, 2) + 
        Math.pow(palmCenter.y - buttonY, 2)
    );
    
    // 如果距离小于阈值，认为手与按钮重叠
    const threshold = 0.2; // 灵敏度
    if (distance < threshold) {
        // 添加视觉反馈
        button.classList.add('active');
        setTimeout(() => button.classList.remove('active'), 200);
        
        // 创建浮动猫猫emoji
        createFloatingEmoji(button);
        
        return true;
    }
    
    return false;
}

// 处理跳跃逻辑
function handleJump() {
    if (isPlayerFrozen) return;
    const player = document.querySelector('.player');
    const currentTime = Date.now();
    
    // 如果正在跳跃，检查是否可以二段跳
    if (isJumping) {
        // 如果两次跳跃间隔小于1.5秒，触发二段跳
        if (currentTime - lastJumpTime < 1500 && !isDoubleJumping) {
            isDoubleJumping = true;
            let jumpHeight = 150;
            let duration = 1200;
            let startY = parseFloat(player.style.bottom || '20px');
            let startTime = Date.now();
            
            function doubleJumpAnimation() {
                let currentTime = Date.now();
                let progress = (currentTime - startTime) / duration;
                
                if (progress < 1) {
                    // 使用二次贝塞尔曲线创建跳跃效果
                    let currentHeight = startY + jumpHeight * 4 * progress * (1 - progress);
                    player.style.bottom = `${currentHeight}px`;
                    requestAnimationFrame(doubleJumpAnimation);
                } else {
                    player.style.bottom = '20px';
                    isJumping = false;
                    isDoubleJumping = false;
                }
            }
            
            requestAnimationFrame(doubleJumpAnimation);
        }
    } else {
        // 普通跳跃
        isJumping = true;
        let jumpHeight = 100;
        let duration = 800;
        let startY = parseFloat(player.style.bottom || '20px');
        let startTime = Date.now();
        
        function jumpAnimation() {
            let currentTime = Date.now();
            let progress = (currentTime - startTime) / duration;
            
            if (progress < 1) {
                // 使用二次贝塞尔曲线创建跳跃效果
                let currentHeight = startY + jumpHeight * 4 * progress * (1 - progress);
                player.style.bottom = `${currentHeight}px`;
                requestAnimationFrame(jumpAnimation);
            } else {
                player.style.bottom = '20px';
                isJumping = false;
            }
        }
        
        requestAnimationFrame(jumpAnimation);
    }
    
    // 更新上次跳跃时间
    lastJumpTime = currentTime;
}

// 创建跳跃时的猫猫emoji动画
function createJumpEmoji(player) {
    // 猫猫emoji数组 - 减少数量
    const catEmojis = ['😺', '😸', '😹', '😻', '🐱'];
    
    // 随机选择一个emoji
    const randomEmoji = catEmojis[Math.floor(Math.random() * catEmojis.length)];
    
    // 创建emoji元素
    const emoji = document.createElement('div');
    emoji.className = 'floating-emoji';
    emoji.textContent = randomEmoji;
    
    // 设置emoji的初始位置（玩家当前位置）
    const playerRect = player.getBoundingClientRect();
    emoji.style.left = `${playerRect.left + playerRect.width/2}px`;
    emoji.style.top = `${playerRect.top + playerRect.height/2}px`;
    
    // 添加到页面
    document.body.appendChild(emoji);
    
    // 动画结束后移除元素
    emoji.addEventListener('animationend', () => {
        emoji.remove();
    });
}

// 创建浮动猫猫emoji
function createFloatingEmoji(button) {
    // 猫猫emoji数组 - 减少数量
    const catEmojis = ['😺', '😸', '😹', '😻', '🐱'];
    
    // 随机选择一个emoji
    const randomEmoji = catEmojis[Math.floor(Math.random() * catEmojis.length)];
    
    // 创建emoji元素
    const emoji = document.createElement('div');
    emoji.className = 'floating-emoji';
    emoji.textContent = randomEmoji;
    
    // 设置emoji的初始位置（按钮中心）
    const buttonRect = button.getBoundingClientRect();
    emoji.style.left = `${buttonRect.left + buttonRect.width/2}px`;
    emoji.style.top = `${buttonRect.top + buttonRect.height/2}px`;
    
    // 添加到页面
    document.body.appendChild(emoji);
    
    // 动画结束后移除元素
    emoji.addEventListener('animationend', () => {
        emoji.remove();
    });
}

// 手势检测
async function detectHands() {
    try {
        const video = document.getElementById('video');
        if (!video.videoWidth || !video.videoHeight) return;
        
        // 使用 MediaPipe Hands 处理视频帧
        await hands.send({image: video});
    } catch (error) {
        console.error('Error in detectHands:', error);
    }
}

// Game logic
function updateHealthBars() {
    document.querySelector('.health-fill').style.width = `${(playerHealth / 20) * 100}%`;
    document.querySelector('.enemy-health-fill').style.width = `${(enemyHealth / 20) * 100}%`;
    
    // Check for rage mode triggers
    if (!isRageMode && (enemyHealth === 15 || enemyHealth === 10 || enemyHealth === 5)) {
        isRageMode = true;
        rageModeCount = 0;
        startRageMode();
    }
}

// 创建玩家被击中时的猫猫emoji
function createHitEmoji(element) {
    const emojis = ['😿', '😾', '😼', '😽', '🙀'];
    const emoji = document.createElement('div');
    emoji.className = 'hit-emoji';
    emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    
    const rect = element.getBoundingClientRect();
    emoji.style.left = `${rect.left + rect.width/2}px`;
    emoji.style.top = `${rect.top + rect.height/2}px`;
    
    document.body.appendChild(emoji);
    emoji.addEventListener('animationend', () => emoji.remove());
}

// 处理打枪猫被击中
function handleEnemyHit() {
    const gif = document.querySelector('.moving-gif');
    gif.classList.add('hit');
    setTimeout(() => gif.classList.remove('hit'), 300);
}

// 更新敌人位置
function moveEnemy() {
    // 不再需要手动移动，由CSS动画处理
    return;
}

// 发射敌人子弹
function shootEnemyBullet() {
    const gif = document.querySelector('.moving-gif');
    const gifRect = gif.getBoundingClientRect();
    const player = document.querySelector('.player');
    const playerRect = player.getBoundingClientRect();
    
    // 发射8颗普通子弹
    for (let i = 0; i < 8; i++) {
        const bullet = document.createElement('div');
        bullet.className = 'bullet';
        
        // 从打枪GIF周围随机位置发射
        const randomOffset = {
            x: (Math.random() - 0.5) * 40,
            y: (Math.random() - 0.5) * 40
        };
        
        const startX = gifRect.left + gifRect.width/2 + randomOffset.x;
        const startY = gifRect.top + gifRect.height/2 + randomOffset.y;
        
        bullet.style.left = `${startX}px`;
        bullet.style.top = `${startY}px`;
        document.body.appendChild(bullet);
        
        const baseAngle = (Math.PI * 2 / 8) * i;
        const randomOffset2 = (Math.random() - 0.5) * Math.PI / 2;
        const angle = baseAngle + randomOffset2;
        
        const speed = 5;
        let bounces = 0;
        
        function moveBullet() {
            const currentX = parseFloat(bullet.style.left);
            const currentY = parseFloat(bullet.style.top);
            
            const newX = currentX + Math.cos(angle) * speed;
            const newY = currentY + Math.sin(angle) * speed;
            
            let newAngle = angle;
            if (newX <= 0 || newX >= window.innerWidth) {
                newAngle = Math.PI - angle;
                bounces++;
            }
            if (newY <= 0 || newY >= window.innerHeight) {
                newAngle = -angle;
                bounces++;
            }
            
            bullet.style.left = `${newX}px`;
            bullet.style.top = `${newY}px`;
            
            const bulletRect = bullet.getBoundingClientRect();
            if (bulletRect.left < playerRect.right &&
                bulletRect.right > playerRect.left &&
                bulletRect.top < playerRect.bottom &&
                bulletRect.bottom > playerRect.top) {
                bullet.remove();
                playerHealth--;
                updateHealthBars();
                createHitEmoji(player);
                if (playerHealth <= 0) {
                    endGame(false);
                }
                return;
            }
            
            if (bounces >= MAX_BOUNCES) {
                bullet.remove();
                return;
            }
            
            requestAnimationFrame(moveBullet);
        }
        
        moveBullet();
    }
    
    // 随机选择发射冻结弹或炸弹弹
    const specialBulletType = Math.random() < 0.5 ? 'freeze' : 'bomb';
    
    if (specialBulletType === 'freeze') {
        // 发射冻结弹
        const freezeBullet = document.createElement('div');
        freezeBullet.className = 'freeze-bullet';
        
        const startX = gifRect.left + gifRect.width/2;
        const startY = gifRect.top + gifRect.height/2;
        
        freezeBullet.style.left = `${startX}px`;
        freezeBullet.style.top = `${startY}px`;
        document.body.appendChild(freezeBullet);
        
        // 计算目标点，添加随机偏移
        const targetX = playerRect.left + playerRect.width/2 + (Math.random() - 0.5) * 200;
        const targetY = playerRect.top + playerRect.height/2 + (Math.random() - 0.5) * 200;
        const angle = Math.atan2(targetY - startY, targetX - startX);
        const speed = 5;
        
        function moveFreezeBullet() {
            const currentX = parseFloat(freezeBullet.style.left);
            const currentY = parseFloat(freezeBullet.style.top);
            
            freezeBullet.style.left = `${currentX + Math.cos(angle) * speed}px`;
            freezeBullet.style.top = `${currentY + Math.sin(angle) * speed}px`;
            
            const bulletRect = freezeBullet.getBoundingClientRect();
            const currentPlayerRect = player.getBoundingClientRect();
            
            // 检查是否击中玩家
            if (bulletRect.left < currentPlayerRect.right &&
                bulletRect.right > currentPlayerRect.left &&
                bulletRect.top < currentPlayerRect.bottom &&
                bulletRect.bottom > currentPlayerRect.top) {
                freezeBullet.remove();
                freezePlayer();
                return;
            }
            
            // 检查是否超出屏幕边界
            if (currentX < 0 || currentX > window.innerWidth || 
                currentY < 0 || currentY > window.innerHeight) {
                freezeBullet.remove();
                return;
            }
            
            requestAnimationFrame(moveFreezeBullet);
        }
        
        moveFreezeBullet();
    } else {
        // 发射炸弹弹
        const bombBullet = document.createElement('div');
        bombBullet.className = 'bomb-bullet';
        bombBullet.textContent = '💣';
        
        const startX = gifRect.left + gifRect.width/2;
        const startY = gifRect.top + gifRect.height/2;
        
        bombBullet.style.left = `${startX}px`;
        bombBullet.style.top = `${startY}px`;
        document.body.appendChild(bombBullet);
        
        // 计算目标点，添加随机偏移
        const targetX = playerRect.left + playerRect.width/2 + (Math.random() - 0.5) * 200;
        const targetY = playerRect.top + playerRect.height/2 + (Math.random() - 0.5) * 200;
        const angle = Math.atan2(targetY - startY, targetX - startX);
        const speed = 5;
        
        function moveBombBullet() {
            const currentX = parseFloat(bombBullet.style.left);
            const currentY = parseFloat(bombBullet.style.top);
            
            bombBullet.style.left = `${currentX + Math.cos(angle) * speed}px`;
            bombBullet.style.top = `${currentY + Math.sin(angle) * speed}px`;
            
            const bulletRect = bombBullet.getBoundingClientRect();
            const currentPlayerRect = player.getBoundingClientRect();
            
            // 检查是否击中玩家
            if (bulletRect.left < currentPlayerRect.right &&
                bulletRect.right > currentPlayerRect.left &&
                bulletRect.top < currentPlayerRect.bottom &&
                bulletRect.bottom > currentPlayerRect.top) {
                bombBullet.remove();
                playerHealth -= 2; // 炸弹子弹扣2点生命值
                updateHealthBars();
                createHitEmoji(player);
                
                // 创建炸弹效果
                const bombText = document.createElement('div');
                bombText.className = 'bomb-text';
                bombText.textContent = '💣';
                document.body.appendChild(bombText);
                
                // 3秒后移除炸弹效果
                setTimeout(() => {
                    bombText.remove();
                }, 3000);
                
                if (playerHealth <= 0) {
                    endGame(false);
                }
                return;
            }
            
            // 检查是否超出屏幕边界
            if (currentX < 0 || currentX > window.innerWidth || 
                currentY < 0 || currentY > window.innerHeight) {
                bombBullet.remove();
                return;
            }
            
            requestAnimationFrame(moveBombBullet);
        }
        
        moveBombBullet();
    }
}

// 冻结玩家
function freezePlayer() {
    if (isPlayerFrozen) return;
    
    isPlayerFrozen = true;
    const player = document.querySelector('.player');
    player.classList.add('frozen-player');
    
    // 创建冻结文字效果
    const freezeText = document.createElement('div');
    freezeText.className = 'freeze-text';
    freezeText.textContent = '❄';
    document.body.appendChild(freezeText);
    
    // 3秒后解除冻结
    setTimeout(() => {
        player.classList.remove('frozen-player');
        freezeText.remove();
        isPlayerFrozen = false;
    }, 3000);
}

// 修改玩家射击函数，添加冻结状态检查
function shootPlayerBullet(direction = 'center') {
    if (isPlayerAttacking || isPlayerFrozen) return;
    isPlayerAttacking = true;

    const player = document.querySelector('.player');
    const playerRect = player.getBoundingClientRect();
    
    // 发射两枚随机子弹
    for (let i = 0; i < 2; i++) {
        const bullet = document.createElement('div');
        bullet.className = 'bullet player-bullet';
        
        // 随机选择子弹类型
        const bulletType = Math.floor(Math.random() * 3) + 1;
        bullet.classList.add(`bullet${bulletType}`);
        
        // 如果是爱心子弹，直接使用emoji
        if (bulletType === 3) {
            bullet.textContent = '❤️';
        }
        
        bullet.style.left = `${playerRect.left + playerRect.width / 2}px`;
        bullet.style.top = `${playerRect.top}px`;
        document.body.appendChild(bullet);

        const gif = document.querySelector('.moving-gif');
        const gifRect = gif.getBoundingClientRect();
        
        // 根据方向设置目标点
        let targetX, targetY;
        
        switch(direction) {
            case 'top-left':
                targetX = 0;
                targetY = 0;
                break;
            case 'bottom-left':
                targetX = 0;
                targetY = window.innerHeight;
                break;
            case 'top-right':
                targetX = window.innerWidth;
                targetY = 0;
                break;
            case 'bottom-right':
                targetX = window.innerWidth;
                targetY = window.innerHeight;
                break;
            case 'center':
            default:
                targetX = gifRect.left + gifRect.width / 2;
                targetY = gifRect.top + gifRect.height / 2;
                break;
        }

        const angle = Math.atan2(targetY - bullet.offsetTop, targetX - bullet.offsetLeft);
        const speed = 5;

        function moveBullet() {
            bullet.style.left = `${parseFloat(bullet.style.left) + Math.cos(angle) * speed}px`;
            bullet.style.top = `${parseFloat(bullet.style.top) + Math.sin(angle) * speed}px`;

            const bulletRect = bullet.getBoundingClientRect();
            if (bulletRect.left < gifRect.right &&
                bulletRect.right > gifRect.left &&
                bulletRect.top < gifRect.bottom &&
                bulletRect.bottom > gifRect.top) {
                bullet.remove();
                enemyHealth--;
                updateHealthBars();
                handleEnemyHit();
                if (enemyHealth <= 0) {
                    endGame(true);
                }
                return;
            }

            if (bulletRect.top < 0 || bulletRect.left < 0 || 
                bulletRect.right > window.innerWidth || 
                bulletRect.bottom > window.innerHeight) {
                bullet.remove();
                return;
            }

            requestAnimationFrame(moveBullet);
        }

        moveBullet();
    }
    
    // 重置攻击状态
    setTimeout(() => {
        isPlayerAttacking = false;
    }, 200);
}

function endGame(isWin) {
    const gameOver = document.createElement('div');
    gameOver.className = `game-over ${isWin ? 'win' : 'lose'}`;
    gameOver.textContent = isWin ? '胜利！' : '失败！';
    document.body.appendChild(gameOver);
    
    if (isWin) {
        setTimeout(() => {
            window.location.href = 'win.html';
        }, 2000);
    } else {
        setTimeout(() => {
            window.location.href = 'lose.html';
        }, 2000);
    }
}

// 更新玩家位置
function updatePlayerPosition() {
    const player = document.querySelector('.player');
    if (player) {
        // 只更新水平位置，保持垂直位置不变
        player.style.transform = `translateX(calc(-50% + ${playerPosition}px))`;
    }
}

// 初始化游戏
async function init() {
    try {
        updateHealthBars();
        await setupCamera();
        await setupHandDetection();
        setInterval(detectHands, DETECTION_INTERVAL);
        setInterval(shootEnemyBullet, 3000);
    } catch (error) {
        console.error('Game initialization error:', error);
        alert('游戏初始化失败，请刷新页面重试。');
    }
}

// 启动游戏
init();

function startRageMode() {
    if (rageModeCount >= 3) {
        isRageMode = false;
        return;
    }
    
    // Create 20 bullets in a circle
    const gif = document.querySelector('.moving-gif');
    const gifRect = gif.getBoundingClientRect();
    const centerX = gifRect.left + gifRect.width / 2;
    const centerY = gifRect.top + gifRect.height / 2;
    
    for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        const bullet = document.createElement('div');
        bullet.className = 'bullet';
        
        bullet.style.left = `${centerX}px`;
        bullet.style.top = `${centerY}px`;
        document.body.appendChild(bullet);
        
        const speed = 5;
        let bounces = 0;
        
        function moveBullet() {
            const currentX = parseFloat(bullet.style.left);
            const currentY = parseFloat(bullet.style.top);
            
            const newX = currentX + Math.cos(angle) * speed;
            const newY = currentY + Math.sin(angle) * speed;
            
            let newAngle = angle;
            if (newX <= 0 || newX >= window.innerWidth) {
                newAngle = Math.PI - angle;
                bounces++;
            }
            if (newY <= 0 || newY >= window.innerHeight) {
                newAngle = -angle;
                bounces++;
            }
            
            bullet.style.left = `${newX}px`;
            bullet.style.top = `${newY}px`;
            
            const bulletRect = bullet.getBoundingClientRect();
            const player = document.querySelector('.player');
            const playerRect = player.getBoundingClientRect();
            
            if (bulletRect.left < playerRect.right &&
                bulletRect.right > playerRect.left &&
                bulletRect.top < playerRect.bottom &&
                bulletRect.bottom > playerRect.top) {
                bullet.remove();
                playerHealth--;
                updateHealthBars();
                createHitEmoji(player);
                if (playerHealth <= 0) {
                    endGame(false);
                }
                return;
            }
            
            if (bounces >= 2) {
                bullet.remove();
                return;
            }
            
            requestAnimationFrame(moveBullet);
        }
        
        moveBullet();
    }
    
    rageModeCount++;
    setTimeout(() => startRageMode(), 1000);
} 