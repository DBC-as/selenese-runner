SELENIUM_JAR=selenium-server-standalone-2.15.0.jar

# exit if selenium is already running
echo 'exit' | nc localhost 4444 && exit

# download selenium if needed
test -f $SELENIUM_JAR || wget http://selenium.googlecode.com/files/$SELENIUM_JAR || exit -1

# start selenium headless
xvfb-run java -jar $SELENIUM_JAR > selenium-server.log 2>&1 &

# wait for startup
until grep "Started org.openqa.jetty.jetty.Server" selenium-server.log; do
    echo waiting for selenium server to start
    sleep 1
done

# log to stdout
tail -f selenium-server.log &
