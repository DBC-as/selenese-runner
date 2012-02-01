// # Script for running a collection of testsuites
var request = require('request');
var soda = require('soda');
var fs = require('fs');

// TODO: document more, and make sure the structure is clear

// This needs to be extracted to a util-library
function escapexml(str) { 
    return str.replace(/[^ !#-;=?-~\n\r\t]/g, function(c) { 
            return '&#' + c.charCodeAt(0) + ';'; 
    }); 
}

function unescapexml(str) {
    return str.replace(/&([a-zA-Z0-9]*);/g, function(orig, entity) {
        var entities = { gt: '>', lt: '<', nbsp: '\xa0' };
        if(entities[entity]) {
            return entities[entity];
        }
        config.callback({
            error: 'internal error, cannot convert entity', 
            entity: entity, 
            str: str});
        return orig;
    });
}


// # The main function
//
// The `config` parameter is an object, which may contain the following properties:
// - `baseurl`: 
// - `replace`:
// - `suitelist`:
// - `callback`:
//
// Variables: `browser`: the webbrowser opened by selenium , `testqueue`: list of urls to tests that need to be executed, `seleneseRegExp`: core of the parser, `selenese`: collection of selenese scripts, key is the filepath and value is a list of selenese commands. `suites`: list of testsuites.
exports.runWithConfig = function(config) {
    var browser;
    var testqueue = [];
    var seleneseRegexp = 
        /<tr>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<.tr>/g;
    var selenese = {};
    var suites;
    
    config.baseurl = config.suitelist.replace(/[^/]*$/, '');

    // read and execute a list of suites
    request(config.suitelist, function (err, response, data) {
        if(!data || err) { 
            console.log(err, response, data); throw err; 
        }

        // remove comments (from # to end-of-line) and take each line/word as a filename
        suites = data
            .replace(/#.*/g, '')
            .split(/\s/)
            .filter(function(e) { 
                return e !== '';
            });

        // make sure we have a server configuration
        var setup = config.setup || {};
        setup.url = setup.url || config.url;

        // connect to server, either saucelabs or local
        if(setup['access-key']) {
            browser = soda.createSauceClient(setup);
        } else {
            browser = soda.createClient(setup);
        }

        // open a browser
        browser.session(function(err) {
            if(err) {
                return config.callback({
                    error: "Internal Error", 
                    err: err, 
                    testDone: true});
            }
            nextSuite();
        });
    });

    // load and execute the next suite in the `suites` list of testsuites
    function nextSuite() {
        // handle empty `suites`-list
        if(suites.length === 0) {
            browser.testComplete(function() {
                config.callback({testDone: true});
            });
            return;
        } 

        // download suite description
        var suite = suites.pop();
        config.callback({testsuite: suite});
        request(config.baseurl + suite, function(err, res, data) {

            // suiteurl is the baseurl for the current suite
            config.suiteurl = (config.baseurl + suite).replace(/[^/]*$/, '');

            if(!data || err) { console.log(err, response, data); throw err; }

            // parse suite description, (replace is the easiest way to map a function on regex-search-hits)
            data.replace(/<a href="([^"]*)">([^<]*)/g, function(_,href,text) {
                // collect the test-urls (relative to suiteurl) 
                testqueue.push(href);
            });
            selenese = {};
            parseTests();
        }); 
    }

    // load and parse the next test from the testqueue. Call itself recursively when done.
    function parseTests() {
        if(testqueue.length === 0) return prepareTests();
        var test = testqueue.pop();

        // read the file
        request(config.suiteurl + test, function(err, res, data) {
            if(!data || err) { console.log(err, response, data); throw err; }
            // `result` is the list of selenese-commands
            var result = [];

            // function for replacement of target or value,
            // depending on the config
            config.replace = config.replace || {};
            function substitute(str) {
                if(config.replace[str] === undefined) {
                    return str;
                } else {
                    return config.replace[str];
                }
            }

            // In selenese, multiple spaces are replaced with `&nbsp;` (`\xa0`), which needs to be fed back as a normal whitespace, or otherwise the test will fail. 
            function unescapeSelenese(str) {
                return str.replace(/\xa0/g, ' ');
            }

            // parse the test (replace is the easiest way to map a funciton on a regex-search)
            data.replace(seleneseRegexp, function(_, command, target, value) {
                result.push({
                    command: command,
                    target: substitute(unescapeSelenese(unescapexml(target))),
                    value: substitute(unescapeSelenese(unescapexml(value)))
                });
            });

            // add the test to the collection of tests
            selenese[test] = result;
            // parse the next test from the queue
            parseTests();
        });
    }

    // Support for beforeEach and afterEach special test case
    // which is pre-/appended to the other testcases
    function prepareTests() {
        var beforeEach = selenese.beforeEach || [];
        delete selenese.beforeEach; 
        var afterEach = selenese.afterEach || [];
        delete selenese.afterEach;

        Object.keys(selenese).forEach(function(key) {
                selenese[key] = beforeEach.concat(selenese[key], afterEach);
        });

        // transform object to a list of objects, 
        // for easier accesss. Then execute the tests.
        tests = Object.keys(selenese).map(function(key) {
            return {name: key, selenese: selenese[key] };
        });
        executeTests(tests);
    }

    // run through the list of tests, 
    // and execute the selenese sequences
    function executeTests(tests) {
        if(tests.length === 0) return nextSuite();

        // fetch next test
        var test = tests.pop();
        config.callback({testcase: test.name});

        // reverse list of selenese commands,
        // to make sure we start with the first
        // when popping from the list.
        test.selenese = test.selenese.reverse();
        executeTest(test, tests);
    }

    function executeTest(test, tests) {
        var sels = test.selenese;
        if(sels.length === 0) {
            return executeTests(tests);
        }
        var sel = sels.pop();
        if(sel.command === 'restartBrowser') {
            browser.testComplete(function() {
                browser.session(function(err) {
                    if(err) {
                        return config.callback({
                            error: "Internal Error", 
                            err: err, 
                            testDone: true});
                    }
                    executeTest(test, tests);
                });
            });
            return;
        } else if(!browser[sel.command]) {
            throw {error: "unknown command", sel: sel};
        }
        config.callback( {
            info: "executing command", 
            command: sel.command, 
            target: sel.target, 
            value: sel.value });
        browser[sel.command](sel.target, sel.value, function(err, body, res) {
            if(err !== null) {
                config.callback({error: err, command: sel.command, target: sel.target, value: sel.value});
                return nextSuite();
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
};

// junitreportes keeps track of the number of running junitReporters.
// when the last report quits, the program exits with the number
// of errors as errorcode. 
var junitreporters = 0;
var errcount = 0;
exports.junitReporter = (function(filename) {
    ++junitreporters;
    var results = {};
    var suite, testcase;

    // transform to junit-result-xml like xml
    // which jenkins integration server parses
    function results2xml() {
        var result = ['<testsuite name="root">\n'];
        Object.keys(results).forEach(function(suite) {
            result.push('<testsuite name="' + escapexml(suite) + '">');
            Object.keys(results[suite]).forEach(function(testcase) {
                result.push('<testcase name="' + escapexml(testcase) + '">');
                    results[suite][testcase].forEach(function(err) {
                        result.push('<failure>' + 
                            escapexml(JSON.stringify(err)) + '</failure>');
                    });
                result.push('</testcase>');
            });
            result.push('</testsuite>\n');
        });
        result.push('</testsuite>\n');
        return result.join('');
    }

    // this is the callback-function,
    // that will accumulate test stats.
    return function(msg) {
        msg.logfile = filename;
        console.log(JSON.stringify(msg));
        if(msg.testsuite) {
            suite = msg.testsuite;
            results[suite] = results[suite] || {};
        }
        if(msg.testcase) {
            testcase = msg.testcase;
            results[suite][testcase] = results[suite][testcase] || [];
        }
        if(msg.error) {
            results[suite][testcase].push(msg);
            errcount++;
        }
        if(msg.testDone) {
            fs.writeFile(filename, results2xml(), function() {
                --junitreporters;
                if(junitreporters === 0 ) {
                    process.exit(errcount);
                }
            });
        }
    };
});
