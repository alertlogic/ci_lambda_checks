/*
 * Configuration of identification for account, user, environment, and checks
 */
var config = {
    /*
     * Cloud Insight Customer ID
     */
    "accountId": "",
    /*
     * Cloud Insight username
     */
    "identifier": "",
    /*
     * Cloud Insight password
     */
    "secret": "",
    /*
     * Cloud Insight Environment ID
     */
    "environmentId": "",
    /*
     * Cloud Insight API URL
     * US: api.cloudinsight.alertlogic.com
     * UK: api.cloudinsight.alertlogic.co.uk
     */
    "api_url": "api.product.dev.alertlogic.com",
    /*
     * Cloud Insight Check Configurations
     */
    "checks": {
        /*
         * Check names must match file names in checks/*.js
         */
        "sg": {
            "name": "sg",
            "enabled": true,
            "configuration": {
                "resourceTypes": [
                    "AWS::EC2::SecurityGroup"
                ],
                "approved_ports": [
                    443,
                    22
                ]
            },
            "vulnerability": {
                id: "custom-001",
                name: "Security Group Ingress Rules Policy Violation",
                description: "Security groups were found to have rules that allow access to ports not officially approved by the security department.",
                remediation: "Restrict security group ingress rules to only include approved port ranges.",
                resolution: "Restrict security group ingress rules to only include approved port ranges. To restrict access to a approved port ranges, set the 'Port Range' field to a range/ranges approved by the security department. Be sure to delete unapproved rules after creating rules that follow official policy.",
                risk: "High",
                scope: "security group",
                ccss_score: "5.4",
                resolution_type:"Reconfigure Security Groups",
                reference:"http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/authorizing-access-to-an-instance.html",
                pci_concern:"N/A",
                ccss_vector: "N/A",
                evidence: "{sg_configuration,0}",
                type : "application/json"
            }
        },
        "namingConvention": {
            "name": "namingConvention",
            "enabled": true,
            "configuration": {
                /*
                * Your callback will only be called when message are received for the following AWS resource types
                */
                "resourceTypes": ["AWS::EC2::Subnet", "AWS::EC2::SecurityGroup", "AWS::EC2::Instance"],
                "conventions": [
                    {
                        "resourceTypes": [
                            "AWS::EC2::Subnet", "AWS::EC2::SecurityGroup", "AWS::EC2::Instance"
                        ],
                        "patterns": ["^[pP](rod)*$", ".*[pP](rod)"]
                        // "patterns": [".*"]
                    }
                ]
            },
            "vulnerability": {
                id: "custom-002",
                name: "AWS Resource Naming Convention Policy Violation",
                description: "AWS Resources were found that do not follow naming convention policy.",
                remediation: "Change the name of the AWS Resource to follow naming convention policy.",
                resolution: "Change the name of the AWS Resource to follow naming convention policy. To change the name of an AWS Resource, set the Name tag to the value that confirms to the naming policy.",
                risk: "Medium",
                scope: "any",
                ccss_score: "3.0",
                resolution_type:"Reconfigure Assets",
                reference:"http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html",
                pci_concern:"N/A",
                ccss_vector: "N/A",
                evidence: "{sg_configuration,0}",
                type : "application/json"
            }
        },
        "requiredTags": {
            "name": "requiredTags",
            "enabled": true,
            "configuration": {
                "resourceTypes": ["AWS::EC2::Subnet", "AWS::EC2::SecurityGroup", "AWS::EC2::Instance"],
                "policies": [
                    {
                        "resourceTypes": ["AWS::EC2::Subnet", "AWS::EC2::SecurityGroup", "AWS::EC2::Instance"],
                        "tags": [
                            {
                                "key": "Name"
                            }
                        ]
                    }
                ]
            },
            "vulnerability": {
                id: "custom-003",
                name: "AWS Resource Required Tags Policy Violation",
                description: "AWS Resources were found that do are not tagged according to resource tagging policy.",
                remediation: "Add required tags to the AWS Resource to follow resource tagging policy.",
                resolution: "Add required tags to the AWS Resource to follow resource tagging policy. To add required tags to the AWS Resource, select a resource from the AWS console, go to the tags tab and add requied tags.",
                risk: "Medium",
                scope: "any",
                ccss_score: "3.0",
                resolution_type:"Reconfigure Assets",
                reference:"http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html",
                pci_concern:"N/A",
                ccss_vector: "N/A",
                evidence: "{sg_configuration,0}",
                type : "application/json"
            }
        }
    }
};

module.exports = config;
