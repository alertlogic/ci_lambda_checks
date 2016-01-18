var async           = require('async'),
    AWS             = require('aws-sdk');

var awsInspector = function(eventType, inScope, awsRegion, vpcId, rawMessage, callback) {
    "use strict";
    if (eventType !== 'scheduledEvent') {
        return callback(null, false);
    }

    AWS.config.update({region: awsRegion});
    return getFindings(new AWS.Inspector({apiVersion: '2015-08-18'}), callback);
};

function getFindings(inspector, resultsCallback) {
    "use strict";
    var results = [],
        params  = {},
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
                processFindings(data.findingArnList, inspector, function(err, data) {
                    if (err) {
                        return callback(err);
                    }
                    nextToken = data.hasOwnProperty('nextToken') ? data.nextToken : null;
                    results = results.concat(data);
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

function processFindings(findingsArns, inspector, callback) {
    "use strict";
    async.map(findingsArns,
        function(findingArn, cb) {
            executeAwsApi(inspector.describeFinding.bind(inspector), {"findingArn": findingArn}, function(err, data) {
                if (err) {
                    console.log("awsInspector check failed. describeFinding returned: '%s'", JSON.stringify(err));
                    return cb(err);
                }
                return expendFinding(data.finding, inspector, function(err, result) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(null, result);
                });
            });
        },
        function(err, results) {
            if (err) {
                return callback(err);
            }
            return callback(null, results);
        }
    );
}

function expendFinding(data, inspector, callback) {
    "use strict";
    var finding = {},
        description = {},
        recommendation = {};
    async.waterfall([
        function(cb) {
            var params = {'localizedTexts': [data.finding], 'locale': 'en_US'};
            executeAwsApi(inspector.localizeText.bind(inspector), params, function(err, result) {
                if (err) {
                    console.log("awsInspector check failed. localizeText returned: '%s'", JSON.stringify(err));
                    return cb(err);
                }
                finding = result;
                return cb(null);
            });
        },
        function(cb) {
            var params = {'localizedTexts': [data.description], 'locale': 'en_US'};
            executeAwsApi(inspector.localizeText.bind(inspector), params, function(err, result) {
                if (err) {
                    console.log("awsInspector check failed. localizeText returned: '%s'", JSON.stringify(err));
                    return cb(err);
                }
                description = result;
                return cb(null);
            });
        },
        function(cb) {
            var params = {'localizedTexts': [data.recommendation], 'locale': 'en_US'};
            executeAwsApi(inspector.localizeText.bind(inspector), params, function(err, result) {
                if (err) {
                    console.log("awsInspector check failed. localizeText returned: '%s'", JSON.stringify(err));
                    return cb(err);
                }
                recommendation = result;
                return cb(null);
            });
        }], function(err) {
            if (err) {
                return callback(err);
            }
            var result = data;
            result['finding'] = finding.results;
            result['description'] = description.results;
            result['recommendation'] = recommendation.results;
            return callback(null, result);
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
            instanceId = findings[i].agentId;
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
    return  {
        id: makeId("custom-aws-inspector-" + inspectorData.ruleName),
        name: "AWS Inspector '" + inspectorData.ruleName + "' Rule Violation",
        description: inspectorData.description[0],
        remediation: makeRemediation(inspectorData.recommendation[0]),
        resolution: inspectorData.recommendation[0],
        risk: inspectorData.severity,
        scope: "host",
        ccss_score: getScore(inspectorData.severity),
        resolution_type:"Reconfigure Assets",
        reference:"https://docs.aws.amazon.com/inspector/latest/userguide/inspector_findings.html",
        pci_concern: inspectorData.ruleName.indexOf('PCI') === -1 ? "N/A" : inspectorData.ruleName,
        ccss_vector: "N/A",
        evidence: JSON.stringify({
                    'findingArn': inspectorData.findingArn,
                    'runArn': inspectorData.runArn,
                    'rulesPackageArn': inspectorData.rulesPackageArn,
                    'ruleName': inspectorData.ruleName,
                    'finding': inspectorData.finding,
                    'attributes': inspectorData.attributes,
                    'userAttributes': inspectorData.userAttributes
                }),
        type:   "application/json"
    };
}

function getScore(severity) {
    "use strict";
    switch (severity) {
        case 'High': return "10.0";
        case 'Medium': return "5.0";
        case 'Low': return "2.5";
        default: return "1.0";
    }
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
