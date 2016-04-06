var async           = require('async'),
    AWS             = require('aws-sdk'),
    awsInspector    = function(input, callback) {
    "use strict";
    if (input.eventType !== 'scheduledEvent') {
        return callback(null, false);
    }

    AWS.config.update({region: input.awsRegion});
    return getFindings(new AWS.Inspector({apiVersion: '2016-02-16'}), callback);
};

function getFindings(inspector, resultsCallback) {
    "use strict";
    var results = [],
        params  = {"maxResults": 500},
        nextToken = null;

    async.doWhilst(
        function(callback) {
            if (null != nextToken) {
                params['nextToken'] = nextToken;
            }

            executeAwsApi(inspector.listFindings.bind(inspector), params, function(err, data) {
                if (err) {
                    console.log("awsInspector check failed. listFindings returned: '%s'", JSON.stringify(err));
                    return callback(err);
                }
                nextToken = data.hasOwnProperty('nextToken') ? data.nextToken : null;

                processFindings(data.findingArns, inspector, function (err, findings) {
                    if (err) { return callback(err); }
                    results = results.concat(findings);
                    return callback(null);
                });
            });
        },
        function() {
            return null !== nextToken;
        },
        function(err) {
            if (err) {
                return resultsCallback(null, false);
            }
            var data = getVulnerabilitiesFromFindings(results);
            if (results.length) {
                return resultsCallback(null, {'vulnerable': true, 'data': data});
            } else {
                return resultsCallback(null, false);
            }
        }
    );
}

function processFindings(findingArns, inspector, resultsCallback) {
    "use strict";
    var results = [];
    console.log("Processing %s findings.", findingArns.length);
    async.whilst(
        function() { return findingArns.length !== 0; },
        function(callback) {
            var params = {
                "findingArns": findingArns.splice(0, 10)
            };
            executeAwsApi(inspector.describeFindings.bind(inspector), params, function(err, result) {
                if (err) {
                    console.log("describeFindings failed. Error: %s", JSON.stringify(err, null, 4));
                    return callback(err);
                }

                results = results.concat(result.findings);
                callback(null);
            });
        },
        function(err) {
            if (err) { return resultsCallback(err); }
            return resultsCallback(null, results);
        }
    );
}

function executeAwsApi(fun, params, callback) {
    "use strict";
    return executeAwsApiEx(fun, params, callback, null, 10);
}

function executeAwsApiEx(fun, params, callback, lastError, retries) {
    "use strict";
    if (!retries) {
        console.log("Maximum retries number reached... fun: " + fun.toString() + ", params: '" + JSON.stringify(params) + "'.");
        return callback(lastError, null);
    }

    fun(params, function(err, data) {
        if (err) {
            switch(err.code) {
                case 'RequestLimitExceeded':
                case 'InternalError':
                case 'ThrottlingException':
                    setTimeout(function() {
                        return executeAwsApiEx(fun, params, callback, err, retries - 1);
                    }, 5000);
                    break;
                default:
                    return callback(err, data);
            }
        } else {
            return callback(err, data);
        }
    });
}

function getVulnerabilitiesFromFindings(findings) {
    "use strict";
    var result = {};
    for (var i = 0; i < findings.length; i++) {
        var vulnerability = getVulnerability(findings[i]),
            instanceId = findings[i].assetAttributes.agentId;
        if (!vulnerability) { continue; }

        if (result.hasOwnProperty(instanceId)) {
            result[instanceId].vulnerabilities.push(vulnerability);
        } else {
            result[instanceId] = {
                'resourceType': 'AWS::EC2::Instance',
                'vulnerabilities': [vulnerability] 
            };
        }
    }
    return result;
}

function getVulnerability(inspectorData) {
    "use strict";
    if (!inspectorData.hasOwnProperty('id')) { return null; }

    return  {
        id: makeId("custom-aws-inspector-" + inspectorData.id),
        name: "AWS Inspector '" + inspectorData.id + "' Violation",
        description: inspectorData.description,
        remediation: makeRemediation(inspectorData.recommendation),
        resolution: inspectorData.recommendation,
        risk: inspectorData.severity,
        scope: "host",
        ccss_score: inspectorData.numericSeverity,
        resolution_type:"Reconfigure Assets",
        reference:"https://docs.aws.amazon.com/inspector/latest/userguide/inspector_findings.html",
        pci_concern: inspectorData.id.indexOf('PCI') === -1 ? "N/A" : inspectorData.id,
        ccss_vector: "N/A",
        evidence: JSON.stringify({
                    'findingArn': inspectorData.arn,
                    'assessmentRunArn': inspectorData.serviceAttributes.assessmentRunArn,
                    'rulesPackageArn': inspectorData.serviceAttributes.rulesPackageArn,
                    'id': inspectorData.id,
                    'title': inspectorData.title,
                    'attributes': inspectorData.attributes,
                    'userAttributes': inspectorData.userAttributes
                }),
        type:   "application/json"
    };
}

function makeId(id) {
    "use strict";
    return id.replace(/[ #,._;'\[\]\{\}\/\\=\)\(\*\&\^\%\$\@\~\`\?]/g,'-');
}

function makeRemediation(remediation) {
    "use strict";
    if (remediation.charAt(0) === '\n') {
        remediation = remediation.slice(1).split(/[\n.]/)[0];
    }
    var res = remediation.split(/[\n.]/)[0].trim();
    if (res.charCodeAt(res.length - 1) < 65 ||
        res.charCodeAt(res.length - 1) > 122) {
        res = res.slice(0, -1);
    }
    res = res + '.';
    
    var removeStrArray = [
        'We recommend you ',
        'We recommend that you ',
        'It is recommended that you '
    ];
    for (var i = 0; i < removeStrArray.length; i++) {
        if (0 === res.indexOf(removeStrArray[i])) {
            res = res.charAt(removeStrArray[i].length).toUpperCase() + res.slice(removeStrArray[i].length + 1);
            break;
        }
    }
    return res;
}

module.exports = awsInspector;
