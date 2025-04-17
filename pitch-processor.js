class PitchProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.sampleRate = sampleRate;
        this.lastValidFrequency = null;
        this.stableCount = 0;
    }

    process(inputs, outputs) {
        const input = inputs[0][0];
        if (!input) return true;

        // 使用自相关算法检测音高
        let sum = 0;
        let maxCorrelation = 0;
        let foundPitch = false;
        
        // 计算自相关
        for (let lag = 0; lag < this.bufferSize; lag++) {
            sum = 0;
            for (let i = 0; i < this.bufferSize - lag; i++) {
                sum += input[i] * input[i + lag];
            }
            
            if (sum > maxCorrelation) {
                maxCorrelation = sum;
                foundPitch = true;
            }
        }
        
        // 计算频率
        const frequency = this.sampleRate / (maxCorrelation > 0 ? maxCorrelation : 1);
        
        // 检查频率是否在有效范围内
        if (foundPitch && frequency >= 200 && frequency <= 1000) {
            // 检查频率是否稳定
            if (this.lastValidFrequency && Math.abs(frequency - this.lastValidFrequency) < 5) {
                this.stableCount++;
            } else {
                this.stableCount = 0;
            }
            
            // 只有当频率稳定一段时间后才发送消息
            if (this.stableCount > 2) {
                this.lastValidFrequency = frequency;
                this.port.postMessage({ frequency });
            }
        } else {
            this.stableCount = 0;
        }

        return true;
    }
}

registerProcessor('pitch-processor', PitchProcessor); 