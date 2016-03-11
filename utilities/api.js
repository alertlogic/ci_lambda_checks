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
    getOne = function(token, params, callback) {
        "use strict";
        var options   = {
                hostname: config.api_url,
                port: 443,
                path: getPath(params, token),
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
            console.log('Failed to fetch an item. Params: ' + JSON.stringify(params) + '. Error: ' + e.message);
            callback("FAILED", e.message);
        });
        req.end();
    },
    /*
     * Fetches a set of items from a service based on filters
     */
    getMany = function(token, params, callback) {
        "use strict";
        var options   = {
                hostname: config.api_url,
                port: 443,
                path: getPath(params, token),
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
            console.log('Failed to fetch a set of items. Params: ' + JSON.stringify(params) + '. Error: ' + e.message);
            callback("FAILED", e.message);
        });
        req.end();
    },
    /*
     * Fetches any set of items from a service
     */
    getAll = function(token, params, callback) {
        "use strict";
        var options   = {
                hostname: config.api_url,
                port: 443,
                path: getPath(params, token),
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
            console.log('Failed to fetch any item. Params: ' + JSON.stringify(params) + '. Error: ' + e.message);
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
 * Generate URL Path from params
 */
function getPath(params, token) {
    "use strict";
    var apiVersion = params.hasOwnProperty('version') ? params.version : version,
        accountId = params.hasOwnProperty('accountId') ? params.accountId : getAccountId(token),
        queryParams = params.hasOwnProperty('query') ? parseQueryString(params.query) : '',
        path = '/' + params.service + '/' + apiVersion + '/' + accountId;

    if (params.hasOwnProperty('endpoint')) {
        path = path + '/' + params.endpoint;
    }
    if (params.hasOwnProperty('id')) {
        path = path + '/' + params.id;
    }
    if (params.hasOwnProperty('prefix')) {
        path = path + '/' + params.prefix;
    }
    return path + queryParams;
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
