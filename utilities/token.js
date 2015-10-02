var config  = require('../config.js');

var getToken = function(callback) {
    "use strict";

    var https   = require('https'),
        options = {
            hostname: 'api.product.dev.alertlogic.com',
            port: 443,
            path: '/aims/v1/authenticate',
            method: 'POST',
            headers: {},
            auth: config.identifier + ':' + config.secret
        },
        req     = https.request(options, function(res){
            res.setEncoding('utf-8');
            var responseString = '';

            res.on('data', function(data) {
                responseString += data;
            });

            res.on('end', function() {
                if (res.statusCode === 200) {
                    var json = JSON.parse(responseString);
                    callback("SUCCESS", json.authentication.token);
                } else {
                    callback("FAILED", res.statusCode);
                }
            });
        });

    req.on('error', function(e) {
        console.log('problem with request: ' + e.message);
        callback("FAILED", e.message);
    });
    req.end();
};

module.exports = getToken;
