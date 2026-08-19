const memoryStore = require('../../store/memoryStore');

module.exports = {
    /**
     * Add session to registry
     * @param {string} userId
     * @param {Object} session
     */
    add(userId, session) {
        if (!userId) {
            return;
        }

        memoryStore.set(userId, session);
    },

    /**
     * Get session from registry
     * @param {string} userId
     * @returns {Object|null}
     */
    get(userId) {
        if (!userId) {
            return null;
        }

        const session = memoryStore.get(userId);

        return session || null;
    },

    /**
     * Remove session from registry
     * @param {string} userId
     */
    remove(userId) {
        if (!userId) {
            return;
        }

        memoryStore.remove(userId);
    },

    /**
     * Check session exists
     * @param {string} userId
     * @returns {boolean}
     */
    has(userId) {
        if (!userId) {
            return false;
        }

        return memoryStore.has(userId);
    },

    /**
     * Get all sessions
     * @returns {*}
     */
    all() {
        return memoryStore.all();
    },

    /**
     * Get all session keys
     * @returns {Array}
     */
    keys() {
        const allSessions = memoryStore.all();

        if (allSessions instanceof Map) {
            return [...allSessions.keys()];
        }

        return [];
    }
};