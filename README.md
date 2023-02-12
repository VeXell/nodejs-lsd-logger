# Node.js logger for LSD Server [![npm version](https://badge.fury.io/js/nodejs-lsd-logger.svg)](https://www.npmjs.com/package/nodejs-lsd-logger)

Node.js logger for [LSD streaming deamon](https://github.com/badoo/lsd)

Logger writes to small files, depending on current time.

```
lsd_dir/category_name/year|month|day|hour|minute.log
// for example
lsd_dir/category_name/202302121626.log
```

All messages written to these files less than PIPE_BUF (4k in Linux by default).

If you write lines larger than PIPE_BUF, logger creates another file with postfix `_big` (for example `lsd_dir/category_name/202302121626_big.log`) and flock(LOCK_EX) for writing.

## Install

```bash
npm install nodejs-lsd-logger
```

## Usage

Import `writeLog` or `writeJson` function from the library and use it to write data.
Both functions return Promise and you can catch logging errors.

```javascript
// import { writeLog } from 'nodejs-lsd-logger';
import { writeJson } from 'nodejs-lsd-logger';

writeJson('path/to/lsd_dir', {
    string: 'string',
    number: 123,
}).catch((error) => {
    console.error(error);
});
```
