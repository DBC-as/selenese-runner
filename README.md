# Script to execute a collection of selenese scripts

[![Build Status](https://secure.travis-ci.org/DBC-as/selenese-runner.png)](http://travis-ci.org/DBC-as/selenese-runner)


# Features

- reads a list of suites, then reads the suites, then read and execute each test
- callback from test-results
- test / integration-server / travis support

# Tasks

- change suitelist to not expect tags
- streamline unit tests
- command line parameters
- autokill possibly existing selenium-unit-test-server
- fewer browser-sessions to run the tests
- better reporting 

# Changelog /tags

- v0.0.2
- v0.0.1 initial version, read and execute testsuitlist, travis-support
