var async           = require('async'),
    AWS             = require('aws-sdk'),
    awsInspector    = function(input, callback) {
    "use strict";

    switch (input.eventType) {
        case 'scheduledEvent':
            break;
        case 'inspectorEvent':
            if (!input.message.hasOwnProperty('event') || input.message.event !== 'ASSESSMENT_RUN_COMPLETED') {
                return callback(null, false);
            }
            break;
        default:
            return callback(null, false);
    }

    AWS.config.update({region: input.awsRegion});
    return handleInspectorEvent(callback);
};

function handleInspectorEvent(callback) {
    "use strict";
    var results = [];
    getAssessmentRunArns(function(err, assessmentRunArns, instances) {
        if (err) {
            return callback(err);
        }
        if (!assessmentRunArns) {
            return callback(null, false);
        }

        async.whilst(
            function() { return assessmentRunArns.length > 0; },
            function(next) {
                var params = {
                        "assessmentRunArns": assessmentRunArns.splice(0, 2)
                    };
                getFindings(params, function(err, findings) {
                    if (err) { return next(err); }
                    results = results.concat(findings);
                    next(null);
                });
            },
            function(err) {
                if (err) { return callback(null, results); }

                if (results.length) {
                    return callback(null, {'vulnerable': true, 'data': getVulnerabilitiesFromFindings(instances, results)});
                } else {
                    return callback(null, false);
                }
            }
        );
    });
}

function getAssessmentRunArns(callback) {
    "use strict";
    async.waterfall([
        function(next) {
            return getAssessmentTemplates(next);
        },

        function(assessmentTemplateArns, next) {
            return getAssessmentRuns(assessmentTemplateArns, next);
        },
        function(assessmentRunArns, next) {
            async.reduce(assessmentRunArns, {}, getAssessmentInstances, function(err, instances) {
                next(null, assessmentRunArns, instances);
            });
        }
    ], function(err, assessmentRunArns, instances) {
        return callback(err, assessmentRunArns, instances);
    });
}

function getAssessmentTemplates(callback) {
    "use strict";
    var inspector = new AWS.Inspector({apiVersion: '2016-02-16'});

    // Get the list of assessment templates
    executeAwsApi(inspector.listAssessmentTemplates.bind(inspector), {}, function(err, data) {
        if (err) {
            return callback(err);
        }
        return callback(null, data.assessmentTemplateArns);
    });
}

// Get the list of assessment runs
function getAssessmentRuns(assessmentTemplateArns, callback) {
    "use strict";
    var inspector = new AWS.Inspector({apiVersion: '2016-02-16'}),
        results = {},
        nextToken = null,
        params = {
            "assessmentTemplateArns": assessmentTemplateArns,
            "filter": {
                "states": ["COMPLETED"]
            }
        };

    async.doWhilst(
        function(next) {
            if (null != nextToken) {
                params['nextToken'] = nextToken;
            }


            executeAwsApi(inspector.listAssessmentRuns.bind(inspector), params, function(err, data) {
                if (err) {
                    console.log("awsInspector check failed. listAssessmentRuns returned: '%s'", JSON.stringify(err));
                    return next(err);
                }
                nextToken = data.hasOwnProperty('nextToken') ? data.nextToken : null;

                processAssessmentRuns(data.assessmentRunArns, results, function(err, runs) {
                    if (err) { return callback(err); }
                    results = runs;
                    return next(null);
                });
            });
        },
        function() {
            return null !== nextToken;
        },
        function(err) {
            if (err) {return callback(err);}
            return callback(null, extractArns(results));
        }
    );
}

function processAssessmentRuns(assessmentRunArns, runs, callback) {
    "use strict";
    var inspector = new AWS.Inspector({apiVersion: '2016-02-16'});

    console.log("Processing %s assessment runs.", assessmentRunArns.length);
    async.whilst(
        function() { return assessmentRunArns.length !== 0; },
        function(next) {
            var params = {
                "assessmentRunArns": assessmentRunArns.splice(0, 5)
            };
    
            executeAwsApi(inspector.describeAssessmentRuns.bind(inspector), params, function(err, data) {
                if (err) {
                    console.log("awsInspector check failed. describeAssessmentRuns returned: '%s'",
                                JSON.stringify(err));
                    return next(err);
                }
                runs = appendAssessmentRuns(data.assessmentRuns, runs);
                return next(null);
            });
        },
        function(err) {
            if (err) { return callback(err); }
            return callback(null, runs);
        }
    );
}

function appendAssessmentRuns(assessmentRuns, result) {
    "use strict";
    for (var i = 0; i < assessmentRuns.length; i++) {
        if (result.hasOwnProperty(assessmentRuns[i].assessmentTemplateArn)) {
            if (result[assessmentRuns[i].assessmentTemplateArn].completedAt < assessmentRuns[i].completedAt) {
                result[assessmentRuns[i].assessmentTemplateArn].runArn = assessmentRuns[i].arn; 
            }
        } else {
            result[assessmentRuns[i].assessmentTemplateArn] = {
                "runArn": assessmentRuns[i].arn,
                "completedAt": assessmentRuns[i].completedAt 
            };
        }
    }
    return result;
}

function getAssessmentInstances(instances, assessmentRunArn, callback) {
    "use strict";
    var inspector = new AWS.Inspector({apiVersion: '2016-02-16'}),
        nextToken = null,
        params = {"assessmentRunArn": assessmentRunArn};

    async.doWhilst(
        function(next) {
            if (null != nextToken) {
                params['nextToken'] = nextToken;
            }

            executeAwsApi(inspector.listAssessmentRunAgents.bind(inspector), params, function(err, data) {
                if (err) {
                    console.log("awsInspector check failed. listAssessmentRunAgents returned: '%s'", JSON.stringify(err));
                    return next(err);
                }
                nextToken = data.hasOwnProperty('nextToken') ? data.nextToken : null;

                for (var i = 0; i < data.assessmentRunAgents.length; i++) {
                    var agentId = data.assessmentRunAgents[i].agentId;
                    if (!instances.hasOwnProperty(agentId)) {
                        instances[agentId] = {
                            'resourceType': 'AWS::EC2::Instance',
                            'vulnerabilities': [] 
                        };
                    }
                }
                return next(null);
            });
        },
        function() {
            return null !== nextToken;
        },
        function(err) {
            return callback(err, instances);
        }
    );
}

function extractArns(runs) {
    "use strict";
    var props = Object.getOwnPropertyNames(runs);
    if (Array.isArray(props)) {
        var runArns = [];
        for (var i = 0; i < props.length; i++) {
            runArns.push(runs[props[i]].runArn);
        }
        return runArns;
    } 
    return null;
}

function getFindings(params, callback) {
    "use strict";
    var inspector = new AWS.Inspector({apiVersion: '2016-02-16'}),
        results = [],
        nextToken = null;

    async.doWhilst(
        function(next) {
            if (null != nextToken) {
                params['nextToken'] = nextToken;
            }

            console.log("Getting AWS Inspector findings. Params: %s", JSON.stringify(params, null, 4));
            executeAwsApi(inspector.listFindings.bind(inspector), params, function(err, data) {
                if (err) {
                    console.log("awsInspector check failed. listFindings returned: '%s'", JSON.stringify(err));
                    return next(err);
                }
                nextToken = data.hasOwnProperty('nextToken') ? data.nextToken : null;

                processFindings(data.findingArns, function (err, findings) {
                    if (err) { return next(err); }
                    results = results.concat(findings);
                    return next(null);
                });
            });
        },
        function() {
            return null !== nextToken;
        },
        function(err) {
            if (err) { 
                return callback(null, false);
            }
            return callback(null, results);
        }
    );
}

function processFindings(findingArns, resultsCallback) {
    "use strict";
    var inspector = new AWS.Inspector({apiVersion: '2016-02-16'}),
        results = [];
    console.log("Processing %s findings.", findingArns.length);
    async.whilst(
        function() { return findingArns.length !== 0; },
        function(callback) {
            var params = {
                "findingArns": findingArns.splice(0, 2)
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

function getVulnerabilitiesFromFindings(instances, findings) {
    "use strict";
    for (var i = 0; i < findings.length; i++) {
        var vulnerability = getVulnerability(findings[i]),
            instanceId = findings[i].assetAttributes.agentId;
        if (!vulnerability) { continue; }

        if (instances.hasOwnProperty(instanceId)) {
            instances[instanceId].vulnerabilities.push(vulnerability);
        } else {
            // Should never get here
            instances[instanceId] = {
                'resourceType': 'AWS::EC2::Instance',
                'vulnerabilities': [vulnerability] 
            };
        }
    }
    return instances;
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
