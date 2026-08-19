const axios = require('axios');
const crypto = require('crypto');

const AWS_EC2_URL = process.env.AWS_EC2_URL || 'http://13.60.61.183:3000';
const SHARED_SECRET = process.env.SHARED_SECRET || 'shivam_secure_2026';
const API_KEY = process.env.API_KEY || 'shivam_secure_2026';

async function callAwsEngine(endpoint, arg2 = 'POST', arg3 = {}) {
    let method = 'POST';
    let payload = {};

    if (typeof arg2 === 'string') {
        method = arg2.toUpperCase();
        payload = arg3 || {};
    } else if (typeof arg2 === 'object' && arg2 !== null) {
        method = 'POST';
        payload = arg2;
    }

    const timestamp = Date.now().toString();
    const dataToSign = method === 'GET' ? '{}' : JSON.stringify(payload);

    const signature = crypto
        .createHmac('sha256', SHARED_SECRET)
        .update(`${timestamp}.${dataToSign}`)
        .digest('hex');

    const config = {
        method: method,
        url: `${AWS_EC2_URL}${endpoint}`,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'x-timestamp': timestamp,
            'x-signature': signature
        },
        timeout: 30000
    };

    if (method !== 'GET') {
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
            console.error('Network/Proxy Error:', error.message);
        }

        const errorMessage = 
            error.response?.data?.message || 
            error.response?.data?.error || 
            error.message;

        throw new Error(errorMessage);
    }
}

module.exports = { callAwsEngine };