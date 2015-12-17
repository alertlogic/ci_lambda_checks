var config        = require('../config.js');
var publishResult = function(token, metadata, result, callback) {
    "use strict";
        //console.log('{Token: ' + token + '}\n');
        var boundary = "----ea78cfc4b509",

            payload = format_multipart(
                [
                    {name: "metadata", contentType: "application/json", content: JSON.stringify(metadata)},
                    {name: "result", contentType: "application/json", content: JSON.stringify(result)}
                ],
                boundary),

            https   = require('https'),

            options = {
                hostname: config.api_url,
                port: 443,
                path: '/scan_result/v1/' + config.accountId,
                method: 'POST',
                headers: {
                    'content-type': "multipart/form-data; boundary=" + boundary,
                    'content-length': payload.length,
                    'x-aims-auth-token': token
                }
            };

        // console.log("Payload: " + payload);
        var postExposure = https.request(options, function(res){
            var responseString = "";
            res.setEncoding('utf-8');
            res.on('data', function(data) {
                responseString += data;
            });
            res.on('end', function() {
                if(res.statusCode === 201) {
                    console.log('Vulnerability Instance Id: ' + responseString + '\n');
                } else {
                    console.log("Failed to create Vulnerability Instance. StatusCode: " + res.statusCode + ", Message: " + res.statusMessage);
                    console.log("Options: " + JSON.stringify(options) + "\nPayload: " + payload);
                }
                return callback();
            });
        });

        postExposure.on('error', function(e) {
            console.log('problem with request: ' + e.message);
            return callback();
        });

        postExposure.write(payload.toString());
        postExposure.end();
};

function format_multipart(parts, boundary) {
    "use strict";
    var res            = [],
        crlf           = '\r\n',
        delimiter      = "--" + boundary + crlf,
        closeDelimiter = "--" + boundary + "--";

    for (var i = 0; i < parts.length; i++) {
        var headers = [
            'Content-Disposition: form-data; name="' + parts[i].name + '"' + crlf,
            'Content-Type: "' + parts[i].contentType+ '"' + crlf
        ];
        res.push(new Buffer(delimiter));
        res.push(new Buffer(headers.join('')));
        res.push(new Buffer(crlf + parts[i].content + crlf));
    }
    res.push(new Buffer(closeDelimiter));
    return Buffer.concat(res);
}

module.exports = publishResult;
