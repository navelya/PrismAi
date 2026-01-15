import fs from 'fs';
import path from 'path';

// Model priority: best to fallback
const MODEL_PRIORITY = [
    // Tier 1: Gemini 3 (Preview)
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',

    // Tier 2: Gemini 2.5 (Stable)
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',

    // Tier 3: Gemini 2.0 (Fallback)
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
];

interface ModelStatus {
    model: string;
    isBlocked: boolean;
    blockedAt?: number; // timestamp in ms
    cooldownType?: 'short' | 'daily'; // 60s or 24h
    errorReason?: string;
}

interface TrackerData {
    [model: string]: ModelStatus;
}

export class ModelManager {
    private static instance: ModelManager;
    private status: Map<string, ModelStatus>;
    private trackerPath: string;

    private constructor() {
        this.status = new Map();
        this.trackerPath = path.join(process.cwd(), 'lib', 'ai', 'rate-limit-tracker.json');
        this.load();
        this.checkAndResetCooldowns();
    }

    static getInstance(): ModelManager {
        if (!ModelManager.instance) {
            ModelManager.instance = new ModelManager();
        }
        return ModelManager.instance;
    }

    /**
     * Get the next available model that's not rate-limited
     */
    getNextAvailableModel(): string {
        this.checkAndResetCooldowns();

        // Find first non-blocked model in priority order
        for (const model of MODEL_PRIORITY) {
            const status = this.status.get(model);
            if (!status || !status.isBlocked) {

                return model;
            }
        }

        // All blocked? Use the one that was blocked longest ago (likely reset)
        const oldestBlocked = this.getOldestBlockedModel();

        return oldestBlocked;
    }

    /**
     * Mark a model as rate-limited
     */
    markAsBlocked(model: string, errorMessage: string): void {
        const cooldownType = this.detectCooldownType(errorMessage);

        this.status.set(model, {
            model,
            isBlocked: true,
            blockedAt: Date.now(),
            cooldownType,
            errorReason: errorMessage,
        });

        const cooldownMin = cooldownType === 'short' ? 1 : 1440; // 1 min or 24 hours


        this.persist();
    }

    /**
     * Check for cooldowns that have expired and reset them
     */
    private checkAndResetCooldowns(): void {
        const now = Date.now();
        let resetCount = 0;

        for (const [model, status] of this.status) {
            if (!status.isBlocked || !status.blockedAt) continue;

            const elapsed = now - status.blockedAt;
            const cooldownMs = status.cooldownType === 'short'
                ? 60 * 1000 // 1 minute
                : 24 * 60 * 60 * 1000; // 24 hours

            if (elapsed >= cooldownMs) {
                status.isBlocked = false;
                delete status.blockedAt;
                delete status.cooldownType;

                resetCount++;
            }
        }

        if (resetCount > 0) {
            this.persist();
        }
    }

    /**
     * Detect cooldown type from error message
     */
    private detectCooldownType(errorMessage: string): 'short' | 'daily' {
        const msg = errorMessage.toLowerCase();

        // Short cooldown indicators
        if (msg.includes('per minute') || msg.includes('rpm') || msg.includes('rate limit')) {
            return 'short';
        }

        // Daily cooldown indicators
        if (msg.includes('daily') || msg.includes('quota') || msg.includes('day')) {
            return 'daily';
        }

        // Default to short (safer to retry sooner)
        return 'short';
    }

    /**
     * Get the model that was blocked longest ago
     */
    private getOldestBlockedModel(): string {
        let oldest: { model: string; blockedAt: number } = {
            model: MODEL_PRIORITY[0],
            blockedAt: Date.now(),
        };

        for (const [model, status] of this.status) {
            if (status.isBlocked && status.blockedAt && status.blockedAt < oldest.blockedAt) {
                oldest = { model, blockedAt: status.blockedAt };
            }
        }

        return oldest.model;
    }

    /**
     * Load tracker data from JSON file
     */
    private load(): void {
        try {
            if (fs.existsSync(this.trackerPath)) {
                const data = fs.readFileSync(this.trackerPath, 'utf-8');
                const trackerData: TrackerData = JSON.parse(data);

                for (const [model, status] of Object.entries(trackerData)) {
                    this.status.set(model, status);
                }


            }
        } catch (error) {
            console.error('Failed to load rate limit tracker:', error);
            // Continue with empty status map
        }
    }

    /**
     * Persist tracker data to JSON file
     */
    private persist(): void {
        try {
            const trackerData: TrackerData = {};

            for (const [model, status] of this.status) {
                trackerData[model] = status;
            }

            // Ensure directory exists
            const dir = path.dirname(this.trackerPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(this.trackerPath, JSON.stringify(trackerData, null, 2), 'utf-8');
        } catch (error) {
            console.error('Failed to persist rate limit tracker:', error);
        }
    }

    /**
     * Get current status for debugging
     */
    getStatus(): ModelStatus[] {
        return Array.from(this.status.values());
    }
}
