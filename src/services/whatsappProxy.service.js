const axios = require('axios');
const crypto = require('crypto');

const DEFAULT_MAIN_SERVER = process.env.MAIN_SERVER_URL || 'http://72.61.242.144';
const SHARED_SECRET = process.env.SHARED_SECRET || 'shivam_secure_2026';
const API_KEY = process.env.API_KEY || 'shivam_secure_2026';

/**
 * Main Server Proxy Caller
 * @param {string} endpoint - Path to hit on main server (e.g., '/api/session/init')
 * @param {string} method - HTTP method ('GET', 'POST', etc.)
 * @param {object} payload - Body payload for POST requests
 * @param {string} customBaseUrl - Optional dynamic main server URL from request body
 */
async function callMainServerEngine(endpoint, method = 'POST', payload = {}, customBaseUrl = null) {
    const targetUrl = customBaseUrl || DEFAULT_MAIN_SERVER;
    const httpMethod = method.toUpperCase();
    const timestamp = Date.now().toString();

    const dataToSign = httpMethod === 'GET' ? '{}' : JSON.stringify(payload);

    const signature = crypto
        .createHmac('sha256', SHARED_SECRET)
        .update(`${timestamp}.${dataToSign}`)
        .digest('hex');

    const config = {
        method: httpMethod,
        url: `${targetUrl}${endpoint}`,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'x-timestamp': timestamp,
            'x-signature': signature
        },
        timeout: 45000
    };

    if (httpMethod !== 'GET') {
        config.data = payload;
    }

    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('Status Code:', error.response.status);
            console.error('Response Data:', error.response.data);
            console.error('Request URL:', error.config?.url);
        } else {
            console.error('Proxy Error:', error.message);
        }

        const errorMessage = 
            error.response?.data?.message || 
            error.response?.data?.error || 
            error.message;

        throw new Error(errorMessage);
    }
}

module.exports = { callMainServerEngine };