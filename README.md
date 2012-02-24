# Script to execute a collection of selenese scripts

[![Build Status](https://secure.travis-ci.org/DBC-as/selenese-runner.png)](http://travis-ci.org/DBC-as/selenese-runner)

# Documentation

## Installation

Stable version can be installed by running `npm install selenese-runner`

For the development version 

- checkout this repository
- fetch dependencies using `npm update`
- test with `npm test`

## Config

Sample config:

    selenese = require('selenese-runner');
    selenese.runWithConfig( {
        suitelist: 'https://raw.github.com/DBC-as/selenese-runner/master/tests/data/testsuites.txt',
        url: 'http://bibliotek.dk', 
        replace: {AUTHOR_PETERSEN: 'petersen'},
        callback: selenese.junitReporter('filename.xml')});

- `suitelist` is a list of urls for selenium-ide testsuites.
- `url` is the url of the site to test (overrides testsuites)
- `replace` includes values to replace within selenium tests. This is useful for for example usernames and passwords
- `callback` is the reporting function

## Run

Just run `node $CONFIG_FILE` (or `NODE_PATH=lib node $CONFIG_FILE` if using the development version where the script is placed in the `lib` directory).
The config can also be passed to the commandline with `-e ...` instead of filename.


# Features

- reads a list of suites, then reads the suites, then read and execute each test
- suites are run in a single browser session, for performance
- callback from test-results
- simple reporting supported with exit-code
- test / integration-server / travis support
- additional commands (*command*, *target*, *value*)
    - (`restartBrowser`, no target, no value)

# Tasks

- refactor code and add more documentation
    - cleanup dependencies
    - better logging with parallel tests
- return error when downloaded suite or testcase is not a file from selenium-ide
- ignore errors in before/after/beforeEach/afterEach 
- better selenese-escape-code
- streamline unit tests
- more info in junit-errorreporting.
- timing information in tests

# Changelog /tags

- v0.0.10 internal documentation, support for local testcases (instead of only loading them via http(s)).
- v0.0.9 error-message when downloaded suite is not a selenium-ide suite
- v0.0.8 error message improvements
- v0.0.7 bugfix
- v0.0.6 refactoring, doc, bugfix: parallel run of browsers
- v0.0.5 published via npm
- v0.0.4 version bump due to packaging error
- v0.0.3 new selenese-command: `restartBrowser`, saucelabs support, bugfix with test-path relative to suite instead of suitelist, junit-xml-output-support
- v0.0.2 single browser session, reporting, exit code
- v0.0.1 initial version, read and execute testsuitlist, travis-support
