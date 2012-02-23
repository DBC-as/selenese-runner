// # Script for running a collection of testsuites
//
// TODO: write intro here
//
// TODO: variable renaming - ensure same naming conventions, and especially function names makes sense after the refactoring
//
// TODO: sanitize docs

// ## Dependencies
var soda = require('soda');
var fs = require('fs');
var async = require('async');

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
exports.runWithConfig = function(config) {
    var basePath = config.suitelist.replace(/[^/]*$/, '');
    var suitePath;
    var substitutions = config.replace || {};
    var setup = Object.create(config.setup || {});
    setup.url = setup.url || config.url;

    // connect to selenium (either in the cloud(sauce) or on internal server)
    var browser;
    if(setup['access-key']) {
        browser = soda.createSauceClient(setup);
    } else {
        browser = soda.createClient(setup);
    }

    // download the suitelist
    read(config.suitelist, function (err, data) {
        if(!data || err) { 
            console.log(err, data); throw err; 
        }

        // start a new browser-session
        browser.session(function(err) {
            if(err) {
                return config.callback({
                    error: "Internal Error", 
                    err: err, 
                    testDone: true});
            }
            // Remove comments in suitelist (comment lines start with #),
            // convert it to an array of suitenames, and call the nextSuite function
            // which processes all of the suites.
            var suiteNames = data
                .replace(/#.*/g, '')
                .split(/\s/)
                .filter(function(e) { 
                    return e !== '';
                });
            async.forEachSeries(suiteNames, 
                executeSuite, 
                function() { 
                    browser.testComplete(function() { 
                        config.callback({testDone: true}); 
                    }); 
                });
        });
    });

    // consume and execute the next suite in the `suites`-list. As the execution is asynchrous, this function will return immediately.
    function executeSuite(suiteName, nextSuiteCallback) {
        config.callback({testsuite: suiteName});

        // download the testsuite
        read(basePath + suiteName, function(err, data) {
            suitePath = (basePath + suiteName).replace(/[^/]*$/, '');

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
                    url: basePath + suiteName
                });
                return nextSuiteCallback();
            }

            var testqueue = [];
            // parse suite (replace is the easiest way to map a function on regex-search-hits)
            data.replace(/<a href="([^"]*)">([^<]*)/g, 
                    function(_,href,text) {
                testqueue.push(href);
            });

            var testcaseAccumulator = {};
            async.forEachSeries(testqueue, 
                function(elem, arrayCallback) {
                    parseTests(elem, testcaseAccumulator, 
                              arrayCallback, nextSuiteCallback);
                },
                function() {
                    prepareAndExecuteTests(testcaseAccumulator, 
                        nextSuiteCallback);
                });
        }); 
    }


    // download and parse the tests from the testqueue. Iteration over the testqueue is done via recursion, as the download is async. 
    function parseTests(test, testcaseAccumulator, 
                        doneCallback, nextSuiteCallback) {
        // when all tests in the testsuite are downloaded, parse and execute the tests
        // read the file
        read(suitePath + test, function(err, data) {
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
            testcaseAccumulator[test] = result;
            doneCallback();
        });
    }

    // Support for beforeEach and afterEach special test case
    // which is pre-/appended to the other testcases
    function prepareAndExecuteTests(testcases, nextSuiteCallback) {
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
        async.forEachSeries(tests, 
            function(elem, doneCallback) {
                executeTestCase(elem, doneCallback, nextSuiteCallback);
            }, nextSuiteCallback);
    }

    // run through the list of tests, 
    // and execute the selenese sequences
    function executeTestCase(test, nextTestCallback, 
                             nextSuiteCallback) {
        config.callback({testcase: test.name});

        // reverse list of selenese commands,
        // to make sure we start with the first
        // when popping from the list.
        async.forEachSeries(test.selenese, 
            function(command, doneCallback) {
                executeCommand(command, doneCallback, 
                               nextTestCallback);
            }, nextTestCallback);
    }

    // Execute the next selenium command in a list of commands,
    // skipping to the next testcase og suite, if the command fails.
    function executeCommand(command, doneCallback, 
                            nextTestCallback) {
        // Do some logging.
        config.callback( {
            info: "executing command", 
            command: command.command, 
            target: command.target, 
            value: command.value });

        // Handle a custom command: `restartBrowser`,
        if(command.command === 'restartBrowser') {
            browser.testComplete(function() {
                browser.session(function(err) {
                    if(err) {
                        return config.callback({
                            error: "Internal Error", 
                            err: err, 
                            testDone: true});
                    }
                    // and jump to the next selenese command when done.
                    doneCallback();
                });
            });
            return;

        // Handle unknown commands or
        } else if(!browser[command.command]) {
            config.callback({
                error: 'unknown command', 
                command: command.command, 
                target: command.target, 
                value: command.value
            });
            return nextTestCallback();
        }

        // and send the command to browser.
        browser[command.command](command.target, command.value, 
                             function(err, response, obj) {
            // If sending the command fails, skip to next suite.
            if(err !== null) {
                config.callback({
                    error: err, 
                    command: command.command, 
                    target: command.target, 
                    value: command.value
                });
                return nextTestCallback();
            }
            // If the result of the command, is failure, signal an error and continue with the next command.
            if(response === 'false') {
                    config.callback({
                        error: "command return false", 
                        command: command.command, 
                        target: command.target, 
                        value: command.value });
            }
            doneCallback();
        });
    }
};

// ## JUnit-compatible reporting callback

// ### Static variables
// Several junit-reporters can be active at once, - there will typically be one per testcollection run by `runWithConfig`. 
// when the last report quits, the program exits with the total `errorCount` as exit code. 
// `junitReporters` keeps track of the number of running `junitReporter`s
var junitReporters = 0;
var errorCount = 0;

// The function itself create a new reporting function, which will write the testreport in a given `filename`.
exports.junitReporter = (function(filename) {
    // During the execution it keeps track of the current `suite`-name and `testcase`, and then record the testresult in the `results`-object which is an object of
    var suite, testcase;
    var errorDetected = false;
    var results = {};

    ++junitReporters;

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
            errorDetected = false;
            testcase = msg.testcase;
            results[suite][testcase] = results[suite][testcase] || [];
        }
        if(msg.error) {
            results[suite][testcase].push(msg);
            if(!errorDetected) {
                errorCount++;
                errorDetected = true;
            }
        }
        if(msg.testDone) {
            fs.writeFile(filename, results2xml(), function() {
                --junitReporters;
                if(junitReporters === 0 ) {
                    process.exit(errorCount);
                }
            });
        }
    };
});

// ## Utility code
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
