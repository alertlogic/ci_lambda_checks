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
    // "api_url": "api.cloudinsight.alertlogic.com",
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
                description: "Security groups were found to have rules that allow access to ports no officially approved by the security department.",
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
            "enabled": false,
            "configuration": {
                "resourceTypes": [
                    "AWS::EC2::Subnet", "AWS::EC2::Instance"
                ],
                "conventions": [
                    {
                        "asset_types": ["AWS::EC2::Subnet", "AWS::EC2::Instance"],
                        "patterns": ["^[p-P]rod.*", ".*[p-P]rod"],
                        "case_sensitive": true
                    }
                ],
                "vulnerability": {
                    id: "custom-002",
                    name: "Instance Naming Convention Policy Violation",
                    description: "Instances were found that do not follow naming convention policy.",
                    remediation: "Change the name of the AWS instance to follow naming convention policy.",
                    resolution: "Change the name of the AWS instance to follow naming convention policy. To change the name of an AWS instance, set the Name tag to the value that confirms to the naming policy.",
                    risk: "Medium",
                    scope: "host",
                    ccss_score: "3.0",
                    resolution_type:"Reconfigure Instances",
                    reference:"http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-instance_linux.html",
                    pci_concern:"N/A",
                    ccss_vector: "N/A",
                    evidence: "{host_configuration,0}",
                    type : "application/json"
                }
            }
        }
    }
};

module.exports = config;
