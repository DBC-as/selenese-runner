require('seleneserunner').runWithConfig( {
    suitelist: 'https://raw.github.com/DBC-as/selenese-runner/master/tests/data/testsuites-error.txt',
    target: 'old-bibdk',
    url: 'http://bibliotek.dk', 
    callback: require('seleneserunner').simpleReporter
    });
