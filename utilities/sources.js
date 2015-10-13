var config     = require('../config.js'),
    getSources = function(token, callback) {
    "use strict";

    if ( !config.hasOwnProperty('accountId') ||
         config.accountId === "" ) {
        config.accountId = JSON.parse(new Buffer(token.split(".")[1], 'base64')).account;
    }

    var https   = require('https'),
        options = {
            hostname: config.api_url,
            port: 443,
            path: '/sources/v1/' + config.accountId + '/sources?source.type=environment',
            method: 'GET',
            headers: {
                "x-aims-auth-token": token
            }
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
                    callback("SUCCESS", json);
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

module.exports = getSources;
