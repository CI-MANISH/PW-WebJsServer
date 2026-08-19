const sessions = new Map();

module.exports = {
    set(userId,data) {
        sessions.set(userId, data);
    },

    get(userId) {
        return sessions.get(userId);
    },

    remove(userId) {
        sessions.delete(userId);
    },

    has(userId) {
        return sessions.has(userId);
    },

    all() {
        return sessions;
    }
};