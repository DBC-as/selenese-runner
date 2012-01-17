export NODE_PATH=lib
node tests/test1.js || exit 1
node tests/test2.js && exit 1
echo test successfull
exit 0
