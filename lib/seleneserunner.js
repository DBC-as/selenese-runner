// # Script for running a collection of testsuites
var request = require('request');
var soda = require('soda');
var fs = require('fs');

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

var browser;

// read and execute a list of suites
function executeSuiteList(config) {
    // find baseurl by stripping filename from url
    config.baseurl = config.suitelist.replace(/[^/]*$/, '');

    request(config.suitelist, 
            function (err, response, data) {
        if(!data || err) { console.log(err, response, data); throw err; }
        suites = parseSuiteList(data);

        browser = soda.createClient({
            'url': config.url
        });
        browser.session(function(err) {
            if(err) return config.callback({error: "Internal Error", err: err, testDone: true});

            (function execEach(suites, testDone) {
                if(suites.length === 0) return testDone();
                executeSuite(config, suites.pop(), function() { execEach(suites, testDone) });
            })(Object.keys(suites).reverse(), function testDone() {
                browser.testComplete(function() {
                    config.callback({testDone: true});
                });
            });
        });
    });
}

// read and execute a single suite
function executeSuite(config, suite, testDone) { request(config.baseurl + suite, function(err, res, data) {
    if(!data || err) { console.log(err, response, data); throw err; }
    config.callback({testsuite: suite});
    // parse suite description, (replace is the easiest way to map a function on regex-search-hits)
    var testqueue = [];
    data.replace(/<a href="([^"]*)">([^<]*)/g, function(_,href,text) {
        testqueue.push(href);
    });

    var selenese = {};
    var seleneseRegexp = /<tr>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<.tr>/g;

    function unescapeSelenese(str) {
        return str.replace(/&([a-zA-Z0-9]*);/g, function(orig, entity) {
            var entities = {
                gt: '>',
                lt: '<',
                nbsp: ' '
            }
            if(entities[entity]) {
                return entities[entity];
            }
            config.callback({error: 'internal error, cannot convert entity', entity: entity, str: str});
            return orig;
        });
    }

    parseTests();
    function parseTests() {
        if(testqueue.length === 0) return prepareTests();
        var test = testqueue.pop();

        request(config.baseurl + test, function(err, res, data) {
            if(!data || err) { console.log(err, response, data); throw err; }
            var result = [];
            config.replace = config.replace || {};
            function substitute(str) {
                return config.replace[str] === undefined ? str : config.replace[str];
            }
            data.replace(seleneseRegexp, function(_, command, target, value) {
                result.push({
                    command: command,
                    target: substitute(unescapeSelenese(target)),
                    value: substitute(unescapeSelenese(value))
                });
            });
            selenese[test] = result;
            parseTests();
        });

    }
    var session;
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
        });
        executeTests(tests);
    }
    function executeTests(tests) {
        if(tests.length === 0) return testDone();
        // Fetch next test
        var test = tests.pop();
        config.callback({testcase: test.name});

        /*
        // Create selenium client
        var browser = soda.createClient({
            'url': config.url
        });
        var session = browser.chain.session();

        var teststep = 0;
        test.selenese.forEach(function(elem) {
            session = session[elem.command](elem.target, elem.value, function(result) {
                // result seems always to be a string
                if(result === 'false') { 
                    config.callback({
                        error: "command return false", 
                        command: elem.command, 
                        target: elem.target, 
                        value: elem.value });
                } else if(result !== '') {
                    config.callback({
                        result: result,
                        command: elem.command, 
                        target: elem.target, 
                        value: elem.value });
                }
            });
        });
        */
        test.selenese = test.selenese.reverse();
        executeTest(test, tests);
    }
    function executeTest(test, tests) {
        var sels = test.selenese;
        if(sels.length === 0) {
            return executeTests(tests);
        }
        var sel = sels.pop();
        if(!browser[sel.command]) {
            throw {error: "unknown command", sel: sel};
        }
        config.callback( {info: "executing command", command: sel.command, target: sel.target, value: sel.value });
        browser[sel.command](sel.target, sel.value, function(err, body, res) {
            if(err !== null) {
                config.callback({error: err});
                return testDone();
            }
            if(body === 'false') {
                    config.callback({
                        error: "command return false", 
                        command: sel.command, 
                        target: sel.target, 
                        value: sel.value });
            }
            executeTest(test, tests);
        });
    }
}); }

exports.runWithConfig = executeSuiteList;

var errcount = 0;
exports.simpleReporter = function(msg) {
    if(!msg.info) {
        console.log(msg);
    }
    if(msg.error) {
        errcount++;
    }
    if(msg.testDone) {
        process.exit(errcount);
    }
}


var junitreporters = 0;
exports.junitReporter = (function(filename) {
    var errcount = 0;
    ++junitreporters;
    var results = {};
    var suite, testcase;
    return function(msg) {
        if(!msg.info) {
            console.log(msg);
        }
        if(msg.testsuite) {
            suite = msg.testsuite;
            results[suite] = results[suite] || {};
        }
        if(msg.testcase) {
            testcase = msg.testcase;
            results[suite][testcase] = results[suite][testcase] || [];
        }
        if(msg.error) {
            results[suite][testcase].push(msg.error);
            errcount++;
        }
        if(msg.testDone) {
            fs.writeFile(filename, JSON.stringify(results), function() {
                --junitreporters;
                if(junitreporters === 0 ) {
                    process.exit(errcount);
                }
            });
        }
    }
});
