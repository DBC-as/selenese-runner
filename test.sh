export NODE_PATH=lib
node tests/test1.js
test $? -eq 0 || exit 1
node tests/test2.js 
test $? -eq 3 || exit 1
echo test ok
exit 0
