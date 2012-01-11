// # Script for running a collection of testsuites
var request = require('request');
var soda = require('soda');

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
    // parse suite description, (replace is the easiest way to map a function on regex-search-hits)
    var testqueue = [];
    data.replace(/<a href="([^"]*)">([^<]*)/g, function(_,href,text) {
        testqueue.push(href);
    });

    var selenese = {};
    var seleneseRegexp = /<tr>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<.tr>/g;

    parseTests();
    function parseTests() {
        if(testqueue.length === 0) return prepareTests();
        var test = testqueue.pop();

        request(config.baseurl + test, function(err, res, data) {
            if(!data || err) { console.log(err, response, data); throw err; }
            var result = [];
            data.replace(seleneseRegexp, function(_, command, target, value) {
                result.push({
                    command: command,
                    target: target,
                    value: value
                });
            });
            selenese[test] = result;
            parseTests();
        });

    }
    function prepareTests() {
        // Support for beforeEach and afterEach special test case
        // which is pre-/appended to the other testcases
        var beforeEach = selenese.beforeEach || [];
        delete selenese.beforeEach; 
        var afterEach = selenese.afterEach || [];
        delete selenese.afterEach;
        Object.keys(selenese).forEach(function(key) {
                selenese[key] = beforeEach.concat(selenese[key], afterEach);
        });

        tests = Object.keys(selenese).map(function(key) {
            return {name: key, selenese: selenese[key] };
        }).reverse();
        console.log(tests, suite, config, selenese);
        executeTests(tests);
    }
    function executeTests(tests) {
        if(tests.length === 0) return next();
        var test = tests.pop();

        // Create selenium client
        var browser = soda.createClient({
            'url': config.url
        });
        var session = browser.chain.session();
        test.selenese.forEach(function(elem) {
            console.log(elem);
            session = session[elem.command](elem.target, elem.value, function(result) {console.log("testresult", result)});
        });
        session.end(function(err) { browser.testComplete(function() {
            console.log("err:", err);
        })});

    }

}); }

// test config, this should be loaded from a config file
// testcode
executeSuiteList({suitelist: 'https://raw.github.com/DBC-as/selenese-runner/master/tests/data/testsuites.txt',
         target: 'old-bibdk', url: 'http://bibliotek.dk' });
