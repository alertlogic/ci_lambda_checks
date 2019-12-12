var config  = require('../config.js'),
    async   = require('async'),
    AWS     = require('aws-sdk');

var getToken = function(params, callback) {
    "use strict";

    async.waterfall(
        [
            function (callback) {
                return getSecret(params, callback);
            },
            authenticate
        ], function (err, token) {
            if (err) {
                return callback("FAILED", err);
            } else {
                return callback("SUCCESS", token);
            }
        }
    );
};

function getSecret(params, callback) {
    "use strict";
    AWS.config.update({region: params.awsRegion});

    var dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'}),
        getItemParams = {
            TableName: "CloudInsightCredentials",
            ProjectionExpression: "secret",
            Key : {
                "name" : { "S" : params.secretName},
                "identifier" : { "S" : params.identifier}
            },
        },
        res = "";
    dynamodb.getItem(getItemParams, function(err, data) {
        if (err) {
            return callback(err);
        }
        var kms = new AWS.KMS({apiVersion: '2014-11-01'}),
            kmsParams = {
                CiphertextBlob: Buffer.from(data.Item.secret.S, 'base64')
            };
        kms.decrypt(kmsParams, function(err, result) {
            if (err) {
                return callback(err);
            }
            res = params.identifier + ':' + Buffer.from(result.Plaintext).toString();
            return callback(null, res); 
        });
    });
}

function authenticate(httpAuth, callback) {
    "use strict";
    var https   = require('https'),
        options = {
            hostname: config.api_url,
            port: 443,
            path: '/aims/v1/authenticate',
            method: 'POST',
            headers: {},
            auth: httpAuth
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
                    callback(null, json.authentication.token);
                } else {
                    callback(res.statusCode);
                }
            });
        });

    req.on('error', function(e) {
        console.log('problem with request: ' + e.message);
        callback(e.message);
    });
    req.end();
}

module.exports = getToken;
