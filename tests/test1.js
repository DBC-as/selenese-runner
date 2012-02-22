require('selenese-runner').runWithConfig( {
    suitelist: './tests/data/testsuites.txt',
    target: 'old-bibdk',
    url: 'http://bibliotek.dk', 
    replace: {AUTHOR_PETERSEN: 'petersen'},
    callback: require('selenese-runner').junitReporter('tests/testresults1.xml')
    });
