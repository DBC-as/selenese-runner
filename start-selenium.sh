SELENIUM_JAR=selenium-server-standalone-2.15.0.jar
test -f $SELENIUM_JAR || wget http://selenium.googlecode.com/files/$SELENIUM_JAR || exit -1
xvfb-run java -jar $SELENIUM_JAR >& selenium-server.log &

until grep "Started org.openqa.jetty.jetty.Server" selenium-server.log; do
    echo waiting for selenium server to start
    sleep 1
done
tail -f selenium-server.log &
