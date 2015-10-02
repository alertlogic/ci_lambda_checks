/*
 * Build dependencies and configuration
 */
var fs            = require('fs');
var glob          = require('glob-all');
var mkdirp        = require('mkdirp');
var path          = require('path');
var uglifyjs      = require('uglify-js');
var prompt        = require('prompt');
var pkg           = require('../package.json');

var base   = pkg.folders.jsSource;
var deploy = pkg.folders.build + pkg.name + '/';

console.log('> Building: ' + deploy);

/*
 * Source location mappings for glob
 */
var source = {
    "application": [
        base + '**/*.js',
        '!' + base + 'build/**',
        '!' + base + 'git-hooks/**',
        '!' + base + 'node_modules/**',
        '!' + base + 'target/**',
        '!' + base + 'utility/**'
    ],
    "config": [
        base + 'package.json'
    ]
};

/*
 * Create the node_modules directory so that it exists for installation regardless of module definitions for deployment
 */
mkdirp(deploy + 'node_modules/', function (err) {
    if (err) {
        return onErr(err);
    }
});

/*
 * Execute glob based distribution of source files
 */
for ( var section in source ) {
    switch (section) {
        default:
            glob.sync(source[section]).forEach(function(item) {
                mkdirp(path.dirname(item.replace(base, deploy)), function (err) {
                    if (err) {
                        return onErr(err);
                    } else {
                        switch (this.section) {
                            case 'application':
                                var minified = uglifyjs.minify(item, {mangle: false});
                                fs.writeFile(item.replace(base, deploy), minified.code.replace('release.version', pkg.version));
                                break;
                            default:
                                fs.createReadStream(item).pipe(fs.createWriteStream(item.replace(base, deploy)));
                                break;
                        }
                    }
                }.bind({section: section}));
            });
            break;
    }
}

/*
 * Update the config.js file with proper information if anything is empty
 */
var config     = require('../config.js'),
    updated    = false,
    properties = [],
    required   = {
        "accountId": "",
        "identifier": "",
        "secret": "",
        "environmentId": "",
        "api_url": ""
    };

function onErr(err) {
    console.error(err);
    return 1;
}

for ( var requirement in required ) {
    var value = config[requirement];
    if (config[requirement] === "") {
        properties.push({"name": requirement});
        updated = true;
    }
}

// Prompt the user for data or fail
if (properties.length > 0) {
    console.log("Some required properties have not been set, please provide them below and we will update your config.js file for you.");
    prompt.start();
    prompt.get(properties, function (err, result) {
        if (err) { return onErr(err); }
        for ( var key in result ) {
            config[key] = result[key];
        };
        var new_config = 'var config = ' + JSON.stringify(config) + ';\nmodule.exports = config;';
        fs.writeFile(deploy + 'config.js', new_config, function(err) {
            if(err) {
                return onErr(err);
            }
        });
    });
}
