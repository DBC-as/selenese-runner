// # Script for running a collection of testsuites
var request = require('request');

// Parse a list of suites
function parseSuiteList(data) {
    var result = {};
    // remove comments
    data = data.replace(/#.*/g, '');
    // split on line
    data = data.split('\n');
    // split lines on whitespaces
    data = data.map(function(elem) { return elem.split(' '); });
    // trim multiple whitespaces
    data = data.map(function(elem) { return elem.filter(function(str) { return str != ''; })});
    // remove empty lines
    data = data.filter(function(elem) { return elem.length > 0});
    // construct object from array of arrays
    data.forEach(function(line) {
       result[line[0]] = {};
       for(var i = 1; i < line.length; ++i) {
           result[line[0]][line[i]] = true;
       }
    });
    return result;
}

// read and execute a list of suites
function executeSuiteList(config) {
    // find baseurl by stripping filename from url
    config.baseurl = config.suitelist.replace(/[^/]*$/, '');

    request(config.suitelist, 
            function (err, response, data) {
        if(!data || err) { console.log(err, response, data); throw err; }
        suites = parseSuiteList(data);

        Object.keys(suites).forEach(function(key) {
            if(suites[key][config.target]) {
                executeSuite(config, key);
            }
        });
    });
}

// read and execute a single suite
function executeSuite(config, suite) { request(config.baseurl + suite, function(err, res, data) {
    if(!data || err) { console.log(err, response, data); throw err; }
    var tests = [];
    // parse suite description, (replace is the easiest way to map a function on regex-search-hits)
    data.replace(/<a href="([^"]*)">([^<]*)/g, function(_,href,text) {
        if(href !== text) { 
            throw {
                error: "error parsing suite file, suites from selenium-IDE has href=text for all links", 
                config: config, suite: suite };
        }
        tests.push(href);
    });
    console.log(tests, suite, config, data);
}); }


// test config, this should be loaded from a config file
// testcode
executeSuiteList({suitelist: 'https://raw.github.com/DBC-as/selenese-runner/master/tests/data/testsuites.txt',
         target: 'old-bibdk', url: 'http://bibliotek.dk' });
