const { API_KEY } = require('../config/env');

module.exports = (req, res, next) => {
    const key = req.headers['x-api-key'];

    if(key !== API_KEY){
        return res.status(401).json({
            success:false,
            message:'Unauthorized'
        });
    }

    next();
};