require('selenese-runner').runWithConfig( {
    suitelist: './tests/data/testsuites-error.txt',
    target: 'old-bibdk',
    url: 'http://bibliotek.dk', 
    callback: require('selenese-runner').junitReporter('tests/testresult.xml')
    });
