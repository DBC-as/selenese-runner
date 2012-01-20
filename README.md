# Script to execute a collection of selenese scripts

[![Build Status](https://secure.travis-ci.org/DBC-as/selenese-runner.png)](http://travis-ci.org/DBC-as/selenese-runner)

# Documentation

Sample config:

    selenese = require('selenese-runner');
    selenese.runWithConfig( {
        suitelist: 'https://raw.github.com/DBC-as/selenese-runner/master/tests/data/testsuites.txt',
        url: 'http://bibliotek.dk', 
        replace: {AUTHOR_PETERSEN: 'petersen'},
        callback: selenese.simpleReporter });

run directly with node.js, - just make sure `selenese-runner.js` is in `NODE_PATH`.

- `suitelist` is a list of urls for selenium-ide testsuites.
- `url` is the url of the site to test (overrides testsuites)
- `replace` includes values to replace within selenium tests. This is useful for for example usernames and passwords
- `callback` is the reporting function


# Features

- reads a list of suites, then reads the suites, then read and execute each test
- suites are run in a single browser session, for performance
- callback from test-results
- simple reporting supported with exit-code
- test / integration-server / travis support
- additional commands (*command*, *target*, *value*)
    - (`restartBrowser`, no target, no value)

# Tasks

- refactor, code and add more documentation
- streamline unit tests
- command line parameters
- autokill possibly existing selenium-unit-test-server

# Changelog /tags

- v0.0.3 mew selenese-command: `restartBrowser`, publish as npm, saucelabs support, bugfix with test-path relative to suite instead of suitelist, junit-xml-output-support
- v0.0.2 single browser session, reporting, exit code
- v0.0.1 initial version, read and execute testsuitlist, travis-support
