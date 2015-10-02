/*
 * Build dependencies and configuration
 */
var fs        = require('fs');
var pkg       = require('../package.json');
var config    = require('../target/ci_lambda_checks/config.js');
var base      = pkg.folders.jsSource;
var zipped    = '../ci_lambda_checks-' + config.accountId + '-' + config.environmentId + '-' + pkg.version + '.zip';
var execfile  = require('child_process').execFile;

console.log("> Zipping: ci_lambda_checks");
process.chdir('target');
process.chdir('ci_lambda_checks');
execfile('zip', ['-r', '-X', zipped, './'], function(err, stdout) {
});
console.log("> Created: " + zipped);
console.log("> Build Complete!");
