// # Script for running a collection of testsuites
//
// Structure of the program
//
// `runWithConfig` is the main function, and contain
// - for each suitename in suitelist
//   - load sui
//

// ## Dependencies
var soda = require('soda');
var fs = require('fs');

// ## Regular expression used for parsing selenese
var seleneseRegexp = 
    /<tr>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<td>(.*?)<.td>\s*<.tr>/g;

// ## Main function: `runWithConfig` 
//
// The `config` parameter is an object, which may contain the following properties:
//
// - `config.url` is the url of the site to test. This is mandatory.
// - `config.suitelist` is an url to file with a list of relative paths to selenium-ide suites. This is mandatory
// - `config.setup` describes where to find the selenium server, - passed to soda. If omitted it will try to connect to a locally running server. This also handles connection to saucelabs if credentials is available.
// - `config.replace` is an optional object with values that should be replaced, - useful for substituting username/password in public visible testcases
// - `config.callback` is the function that handles results of the tests. Has single parameter which is an object with the event. 
//
// Variables: 
//
// - `browser` is the webbrowser opened by selenium 
// - `testqueue` is a list of urls to tests that need to be executed 
// - `testcases` is the collection of selenese scripts, key is the filepath and value is a list of selenese commands
// - `suites` is the list of testsuites read from the suitelist
// 
exports.runWithConfig = function(config) {
    var browser;
    var testqueue = [];
    var testcases = {};
    var suites;
    var suiteurl;
    var substitutions = config.replace || {};
    
    var baseurl = config.suitelist.replace(/[^/]*$/, '');

    // download the suitelist
    read(config.suitelist, function (err, data) {
        if(!data || err) { 
            console.log(err, data); throw err; 
        }

        // remove comments in suitelist (comment lines start with #)
        suites = data
            .replace(/#.*/g, '')
            .split(/\s/)
            .filter(function(e) { 
                return e !== '';
            });

        var setup = config.setup || {};
        setup.url = setup.url || config.url;

        // connect to selenium (either in the cloud(sauce) or on internal server) and start a new browser-session.
        if(setup['access-key']) {
            browser = soda.createSauceClient(setup);
        } else {
            browser = soda.createClient(setup);
        }

        browser.session(function(err) {
            if(err) {
                return config.callback({
                    error: "Internal Error", 
                    err: err, 
                    testDone: true});
            }
            // start executing the suites
            nextSuite();
        });
    });

    // consume and execute the next suite in the `suites`-list. As the execution is asynchrous, this function will return immediately.
    function nextSuite() {
        if(suites.length === 0) {
            browser.testComplete(function() {
                config.callback({testDone: true});
            });
            return;
        } 
        var suite = suites.pop();
        config.callback({testsuite: suite});

        // download the testsuite
        read(baseurl + suite, function(err, data) {
            suiteurl = (baseurl + suite).replace(/[^/]*$/, '');

            if(!data || err) { 
                console.log(err, data); throw err; 
            }

            // if the suite is not a valid selenium-de suite,
            // send error message, and skip to next suite.
            if(!data.match('<table id="suiteTable" cellpadding="1" ' +
                    'cellspacing="1" border="1" class="selenium">')) {
                config.callback({
                    testcase: 'error-before-testcase-reached'});
                config.callback({
                    error: "Testsuite doesn't look like a testsuite-" +
                           "file from selenium-IDE. Check that the " +
                           "url actually exists", 
                    url: baseurl + suite 
                });
                return nextSuite();
                
            }

            // parse suite (replace is the easiest way to map a function on regex-search-hits)
            data.replace(/<a href="([^"]*)">([^<]*)/g, 
                    function(_,href,text) {
                testqueue.push(href);
            });

            testcases = {};
            parseTests(nextSuite);
        }); 
    }


    // download and parse the tests from the testqueue. Iteration over the testqueue is done via recursion, as the download is async. 
    function parseTests(nextSuiteCallback) {
        /* TODO: this should be moved to the end of the function 
           for more clear flow*/
        // when all tests in the testsuite are downloaded, parse and execute the tests
        if(testqueue.length === 0) return prepareAndExecuteTests(nextSuiteCallback);

        var test = testqueue.pop();

        // read the file
        read(suiteurl + test, function(err, data) {
            if(!data || err) { 
                console.log(err, data); throw err; 
            }
            // `result` is the list of selenese-commands
            var result = [];

            // function for replacement of target or value,
            // depending on the config
            function substitute(str) {
                if(substitutions[str] === undefined) {
                    return str;
                } else {
                    return substitutions[str];
                }
            }

            // In selenese, multiple spaces are replaced with `&nbsp;` (`\xa0`), which needs to be fed back as a normal whitespace, or otherwise the test will fail. 
            function unescapeSelenese(str) {
                return str.replace(/\xa0/g, ' ');
            }

            // parse the test (replace is the easiest way to map a funciton on a regex-search)
            data.replace(seleneseRegexp, 
                    function(_, command, target, value) {
                result.push({
                    command: command,
                    target: substitute(unescapeSelenese(
                                unescapexml(target))),
                    value: substitute(unescapeSelenese(
                                unescapexml(value)))
                });
            });

            // add the test to the collection of tests
            testcases[test] = result;
            parseTests(nextSuiteCallback);
        });
    }

    // Support for beforeEach and afterEach special test case
    // which is pre-/appended to the other testcases
    function prepareAndExecuteTests(nextSuiteCallback) {
        var beforeEach = testcases.beforeEach || [];
        delete testcases.beforeEach; 
        var afterEach = testcases.afterEach || [];
        delete testcases.afterEach;

        Object.keys(testcases).forEach(function(key) {
                testcases[key] = 
                    beforeEach.concat(testcases[key], afterEach);
        });

        // transform object to a list of objects, 
        // for easier accesss. Then execute the tests.
        tests = Object.keys(testcases).map(function(key) {
            return {name: key, selenese: testcases[key] };
        });
        executeNextTest(tests, nextSuiteCallback);
    }

    // run through the list of tests, 
    // and execute the selenese sequences
    function executeNextTest(tests, nextSuiteCallback) {
        // when no more tests, skip to next suite
        if(tests.length === 0) return nextSuiteCallback();

        // fetch next test
        var test = tests.pop();
        config.callback({testcase: test.name});

        // reverse list of selenese commands,
        // to make sure we start with the first
        // when popping from the list.
        test.selenese = test.selenese.reverse();
        executeTestStep(test, function() {
                    executeNextTest(tests, nextSuiteCallback); 
        }, nextSuiteCallback);
    }

    // Execute the next selenium command in the test case. 
    function executeTestStep(test, nextTestCallback, nextSuiteCallback) {
        // Find the next selenese command to execute,
        // or skip to the next testcase,
        // if there are no more.
        var sels = test.selenese;
        if(sels.length === 0) {
            return nextTestCallback();
        }
        var sel = sels.pop();

        // Handle a custom command, `restartBrowser`,
        if(sel.command === 'restartBrowser') {
            browser.testComplete(function() {
                browser.session(function(err) {
                    if(err) {
                        return config.callback({
                            error: "Internal Error", 
                            err: err, 
                            testDone: true});
                    }
        // and jump to the next selenese command when done.
                    executeTestStep(test, nextTestCallback, nextSuiteCallback);
                });
            });
            return;

        // Handle unknown commands,
        } else if(!browser[sel.command]) {
            config.callback({
                error: 'unknown command', 
                command: sel.command, 
                target: sel.target, 
                value: sel.value
            });
            return nextSuiteCallback();
        }

        // do some logging
        config.callback( {
            info: "executing command", 
            command: sel.command, 
            target: sel.target, 
            value: sel.value });

        // and send the command to browser.
        browser[sel.command](sel.target, sel.value, 
                             function(err, response, obj) {
            // If sending the command fails, skip to next test.
            if(err !== null) {
                config.callback({
                    error: err, 
                    command: sel.command, 
                    target: sel.target, 
                    value: sel.value
                });
                return nextSuiteCallback();
            }
            // If the result of the command, is failure, signal an error.
            if(response === 'false') {
                    config.callback({
                        error: "command return false", 
                        command: sel.command, 
                        target: sel.target, 
                        value: sel.value });
            }
            // Execute the next selenese command, - when the test execution is done, go to the next suite
            executeTestStep(test, nextTestCallback, nextSuiteCallback);
        });
    }
};

// ## JUnit-compatible reporting callback

// ### Static variables
// Several junit-reporters can be active at once, - there will typically be one per testcollection run by `runWithConfig`. 
// when the last report quits, the program exits with the total `error_count` as exit code. 
// `junitreporters` keeps track of the number of running `junitReporter`s
var junitreporters = 0;
var error_count = 0;

// The function itself create a new reporting function, which will write the testreport in a given `filename`.
exports.junitReporter = (function(filename) {
    // During the execution it keeps track of the current `suite`-name and `testcase`, and then record the testresult in the `results`-object which is an object of
    var suite, testcase;
    var results = {};

    ++junitreporters;

    // Transform to junit-result-xml like xml
    // which jenkins integration server parses
    function results2xml() {
        var result = ['<testsuite name="root">\n'];
        Object.keys(results).forEach(function(suite) {
            result.push('<testsuite name="' + escapexml(suite) + '">');
            Object.keys(results[suite]).forEach(function(testcase) {
                result.push('<testcase name="' + 
                            escapexml(testcase) + '">');
                    results[suite][testcase].forEach(function(err) {
                        result.push('<failure>' + 
                                    escapexml(JSON.stringify(err)) + 
                                    '</failure>');
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
            error_count++;
        }
        if(msg.testDone) {
            fs.writeFile(filename, results2xml(), function() {
                --junitreporters;
                if(junitreporters === 0 ) {
                    process.exit(error_count);
                }
            });
        }
    };
});

// ## Legacy code
// TODO: This should be replaced with functions from xml-library instead...
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
        throw({ 
            error: 'internal error, cannot convert entity', 
            entity: entity, 
            str: str
        });
        return orig;
    });
}


// asynchronous read, either file or url.
// TODO: this is general code, that should be extracted to a library
function read(filename, callback) {
    if(filename.match(/^https?:\/\//i)) {
        require('request')(filename, function(err, response, data) { 
            callback(err,data) 
        });
    }  else {
        fs.readFile(filename, 'utf-8', callback);
    }
}
