require('selenese-runner').runWithConfig( {
    suitelist: 'https://raw.github.com/DBC-as/selenese-runner/master/tests/data/testsuites.txt',
    target: 'old-bibdk',
    url: 'http://bibliotek.dk', 
    replace: {AUTHOR_PETERSEN: 'petersen'},
    callback: require('selenese-runner').junitReporter('tests/testresults1.xml')
    });
