// # Script for running a collection of testsuites
//
// TODO: write intro here
//
// TODO: suitePath pass through as parameter.
//

// ## Dependencies
var soda = require('soda');
var fs = require('fs');
var async = require('async');


// ## Main function
//
// The `config` parameter is an object, which may contain the following properties:
//
// - `config.url` may be the url of the site to test. If this is not present, there must be an url-property in config.setup
// - `config.suitelist` must be the filename/url to the list of relative paths to selenium-ide suites. 
// - `config.setup` describes where to find the selenium server, - passed to soda. If omitted it will try to connect to a locally running server. This also handles connection to saucelabs if credentials is available.
// - `config.replace` is an optional object with values that should be replaced, - useful for substituting username/password in public visible testcases
// - `config.callback` must be a function that handles results of the tests. Has single parameter which is an object with the event. 
//
exports.runWithConfig = function(config) {
    var basePath = config.suitelist.replace(/[^/]*$/, '');
    var suitePath;
    var setup = Object.create(config.setup || {});
    setup.url = setup.url || config.url;

    // Connect to selenium (either in the cloud(sauce) or on internal server).
    var browser;
    if(setup['access-key']) {
        browser = soda.createSauceClient(setup);
    } else {
        browser = soda.createClient(setup);
    }

    // Load the list of suites,
    read(config.suitelist, function (err, data) {
        if(!data || err) { 
            console.log(err, data); throw err; 
        }

        // and start a new browser-session.
        browser.session(function(err) {
            if(err) {
                return config.callback({
                    error: "Internal Error", 
                    err: err, 
                    testDone: true});
            }
            // Remove comments in suitelist (comment lines start with #),
            // and convert it to an array of names of suites.
            var suiteNames = data
                .replace(/#.*/g, '')
                .split(/\s/)
                .filter(function(e) { 
                    return e !== '';
                });
            // Then execute each of the suites.
            //
            // `async.forEachSeries` is an utility function that
            // maps an asynchrouns function across an array. It has
            // three parameters: 1) the array, 2) a function which is
            // executed on each array element, with the element and a
            // callback as parameters, where the callback must be called
            // when the function is done, and 3) a function that will
            // be called when all is done.
            async.forEachSeries(suiteNames, 
                executeSuite, 
                function() { 
                    browser.testComplete(function() { 
                        config.callback({testDone: true}); 
                    }); 
                });
        });
    });


    // ### Load, process and execute a testsuite
    function executeSuite(suiteName, nextSuiteCallback) {
        config.callback({testsuite: suiteName});

        // Load the testsuite.
        read(basePath + suiteName, function(err, data) {
            suitePath = (basePath + suiteName).replace(/[^/]*$/, '');

            if(!data || err) { 
                console.log(err, data); throw err; 
            }

            // If the suite is not a valid selenium-ide suite,
            // report an error, and skip to next suite.
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

            // Extract the names of the tests from the testsuite.
            var tests = [];
            data.replace(/<a href="([^"]*)">([^<]*)/g, 
                    function(_,href,text) {
                tests.push(href);
            });

            // Load, parse, 
            var testcaseAccumulator = {};
            async.forEachSeries(tests, 
                function(elem, arrayCallback) {
                    parseTest(elem, testcaseAccumulator, 
                              arrayCallback, nextSuiteCallback);
                },
                // preprocess, and execute the testcases.
                function() {
                    prepareAndExecuteTests(testcaseAccumulator, 
                        nextSuiteCallback);
                });
        }); 
    }


    // ### Load and parse a testcase
    // The testcases will be stored in the testcaseAccumulator.
    function parseTest(test, testcaseAccumulator, 
                        doneCallback, nextSuiteCallback) {
        read(suitePath + test, function(err, data) {
            if(!data || err) { 
                console.log(err, data); throw err; 
            }

            // The list of selenese-commands in the testcase.
            var commands = [];

            // Substitute target and value of each command 
            // according to `config.replace`.
            var substitutions = config.replace || {};
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

            // Parse the test, 
            data.replace(RegExp('<tr>\\s*<td>(.*?)<.td>\\s*' +
                                '<td>(.*?)<.td>\\s*' +
                                '<td>(.*?)<.td>\\s*<.tr>', 'g')
                        , 
                    function(_, command, target, value) {
                // unescape it, and store the result 
                // in the list of commands.
                commands.push({
                    command: command,
                    target: substitute(unescapeSelenese(
                                unescapexml(target))),
                    value: substitute(unescapeSelenese(
                                unescapexml(value)))
                });
            });

            // Add the test to the collection of tests.
            testcaseAccumulator[test] = commands;
            doneCallback();
        });
    }

    // ### Preprocess testcases in a suite and execute them
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

        // Transform object to a list of objects, 
        // for easier accesss. Then execute the tests.
        tests = Object.keys(testcases).map(function(key) {
            return {name: key, selenese: testcases[key] };
        });
        async.forEachSeries(tests, 
            function(elem, doneCallback) {
                executeTestCase(elem, doneCallback, nextSuiteCallback);
            }, nextSuiteCallback);
    }

    // ### Execute all commands in a single testcase
    function executeTestCase(test, nextTestCallback, 
                             nextSuiteCallback) {
        config.callback({testcase: test.name});

        async.forEachSeries(test.selenese, 
            function(command, doneCallback) {
                executeCommand(command, doneCallback, 
                               nextTestCallback);
            }, nextTestCallback);
    }

    // ### Execute a single selenium command
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
            // If sending the command fails, skip to next test.
            if(err !== null) {
                config.callback({
                    error: err, 
                    command: command.command, 
                    target: command.target, 
                    value: command.value
                });
                return nextTestCallback();
            }
            // If the result of the command, is failure, 
            // signal an error. 
            if(response === 'false') {
                    config.callback({
                        error: "command return false", 
                        command: command.command, 
                        target: command.target, 
                        value: command.value });
            }
            // Continue with the next command.
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

// ### The reporting function generator
// The function itself create a new reporting function, which will write the testreport in a given `filename`.
exports.junitReporter = (function(filename) {
    ++junitReporters;

    // During the execution it keeps track of the current `suite`-name and `testcase`, and then record the testresult in the `results`-object. `errorDetected` keeps track that we only report one error per testcase, even if there are several failures.
    var suite, testcase;
    var results = {};
    var errorDetected = false;

    // #### Generate xml report
    // Transform to junit-like xml for Jenkins
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

    // #### Callback function accumulating test results
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
        // Exit with error code when all JunitReporters are done.
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
// ### xml escape/unescape
// TODO: extract to library
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


// ### Easy reading from url or file
// TODO: extract to library
function read(filename, callback) {
    if(filename.match(/^https?:\/\//i)) {
        require('request')(filename, function(err, response, data) { 
            callback(err,data) 
        });
    }  else {
        fs.readFile(filename, 'utf-8', callback);
    }
}
