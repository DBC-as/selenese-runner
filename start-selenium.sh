SELENIUM_JAR=selenium-server-standalone-2.15.0.jar
test -f $SELENIUM_JAR || wget http://selenium.googlecode.com/files/$SELENIUM_JAR || exit -1
java -jar $SELENIUM_JAR
