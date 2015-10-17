/* exported api */
/*jshint -W089 */
var https   = require('https'),
    config  = require('../config.js'),
    api     = require('./api.js'),
    version = 'v1',
    client  = 'alert-logic-nodejs-v1',
    /*
     * Fetches any single item from a service
     */
    getOne = function(token, service, endpoint, id, callback) {
        "use strict";
        var accountId = getAccountId(token),
            options   = {
                hostname: config.api_url,
                port: 443,
                path: '/' + service + '/' + version + '/' + accountId + '/' + endpoint +'/' + id,
                method: 'GET',
                headers: {
                    "user-agent": client,
                    "x-aims-auth-token": token
                }
            },
            req       = https.request(options, function(res){
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
            console.log('Call to ' + service + ' for ' + endpoint + ' failed because:\n' + e.message);
            callback("FAILED", e.message);
        });
        req.end();
    },
    /*
     * Fetches a set of items from a service based on filters
     */
    getMany = function(token, service, endpoint, id, query, callback) {
        "use strict";
        var accountId = getAccountId(token),
            result    = parseQueryString(query),
            options   = {
                hostname: config.api_url,
                port: 443,
                path: '/' + service + '/' + version + '/' + accountId + '/' + endpoint + '/' + id + '/' + service + result,
                method: 'GET',
                headers: {
                    "user-agent": client,
                    "x-aims-auth-token": token
                }
            },
            req       = https.request(options, function(res){
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
            console.log('Call to ' + service + ' for ' + endpoint + ' failed because:\n' + e.message);
            callback("FAILED", e.message);
        });
        req.end();
    },
    /*
     * Fetches any set of items from a service
     */
    getAll = function(token, service, endpoint, query, callback) {
        "use strict";
        var accountId = getAccountId(token),
            result    = parseQueryString(query),
            options   = {
                hostname: config.api_url,
                port: 443,
                path: '/' + service + '/' + version + '/' + accountId + '/' + endpoint + result,
                method: 'GET',
                headers: {
                    "user-agent": client,
                    "x-aims-auth-token": token
                }
            },
            req       = https.request(options, function(res){
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
            console.log('Call to ' + service + ' for ' + endpoint + ' failed because:\n' + e.message);
            callback("FAILED", e.message);
        });
        req.end();
    };

/*
 * Parses a Cloud Insight token to find the account id
 */
function getAccountId(token) {
    "use strict";
    if ( !config.hasOwnProperty('accountId') ||
         config.accountId === "" ) {
        config.accountId = JSON.parse(new Buffer(token.split(".")[1], 'base64')).account;
    }
    return config.accountId;
}

/*
 * Turns an object of key value pairs into an http query string
 */
function parseQueryString(query) {
    "use strict";
    var result = '';
    for (var index in query) {
        if (result === '') {
            result = result + index + '=' + query[index];
        } else {
            result = result + '&' + index + '=' + query[index];
        }
    }
    return (result === '') ? '' : '?' + result;
}

/*
 * Export available public methods to external clients
 */
module.exports = {
    "getOne": getOne,
    "getMany": getMany,
    "getAll": getAll
};
