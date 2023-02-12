import fs, { constants } from 'fs';
import os from 'os';
import { flock } from 'fs-ext';

type ERRORS = 'FILE_LOCKED';

type IMessage = {
    filePath: string;
    message: string;
    isLargeData: boolean;
};

const MAX_MESSAGE_SIZE = 4096;
const FILE_PERMISSION = 0o666;
const STORED_MESSAGES: IMessage[] = [];

class LogException extends Error {
    code?: ERRORS;

    constructor(message: string, code?: ERRORS) {
        super(message);
        this.code = code;
        Object.setPrototypeOf(this, LogException.prototype);
    }
}

let repeatTimer: undefined | ReturnType<typeof setTimeout>;

export const writeJson = async (dirPath: string, json: Object) => {
    return writeLog(dirPath, JSON.stringify(json));
};

export const writeLog = async (dirPath: string, message: string) => {
    try {
        await fs.promises.access(dirPath, constants.F_OK | constants.W_OK);
    } catch (error) {
        const fileError = error as NodeJS.ErrnoException;

        if (fileError.code === 'ENOENT') {
            // Directory does not exists. Try to create it
            try {
                await fs.promises.mkdir(dirPath, {
                    recursive: true,
                    mode: 0o777,
                });
                // Forse permissions
                await fs.promises.chmod(dirPath, 0o777);
            } catch (mkdirError) {
                throw new Error(`Can not create folder "${dirPath}". Error ${mkdirError}`);
            }
        } else {
            throw new Error(
                `Not enough permissions to create path "${dirPath}". Error: ${fileError}`
            );
        }
    }

    let fileName = getFileName();
    let isLargeData = false;

    if (message.length > MAX_MESSAGE_SIZE) {
        fileName = `${fileName}_big`;
        isLargeData = true;
    }

    const filePath = `${dirPath}/${fileName}.log`;
    const logMessageData = {
        isLargeData,
        filePath,
        message,
    };

    try {
        await writeData(logMessageData);
    } catch (error) {
        const logError = error as LogException;

        if (logError.code === 'FILE_LOCKED') {
            console.error(`WRITING WARNING!: File "${filePath}" is locked.`);
            STORED_MESSAGES.push(logMessageData);
            tryToWriteStoredData();
        } else {
            throw new Error(logError.message);
        }
    }
};

function tryToWriteStoredData() {
    if (!STORED_MESSAGES.length) {
        // @ts-ignore
        clearInterval(repeatTimer);
        repeatTimer = undefined;
        return;
    }

    if (repeatTimer) {
        // We already have one timer
        return;
    }

    repeatTimer = setTimeout(async () => {
        // @ts-ignore
        clearInterval(repeatTimer);
        repeatTimer = undefined;

        const data = STORED_MESSAGES.shift();

        if (data) {
            try {
                await writeData(data);
                // console.log('Repeat data success');
            } catch (error) {
                console.error(
                    `Repeat write warning: File "${data.filePath}" is locked. ${Number(new Date())}`
                );
                STORED_MESSAGES.unshift(data);
            }

            if (STORED_MESSAGES.length) {
                // Run again with timer
                tryToWriteStoredData();
            }
        }
    }, 100);
}

async function writeData({ filePath, isLargeData, message }: IMessage) {
    const oldMask = process.umask(0);

    if (isLargeData) {
        await writeToFileWithLock(filePath, message);
    } else {
        await writeToFile(filePath, message);
    }

    process.umask(oldMask);
}

function getFileName() {
    const now = new Date();
    const year = new Intl.DateTimeFormat('en', { year: 'numeric' }).format(now);
    const month = new Intl.DateTimeFormat('en', { month: '2-digit' }).format(now);
    const day = new Intl.DateTimeFormat('en', { day: '2-digit' }).format(now);
    const hour = new Intl.DateTimeFormat('en', { hour: '2-digit', hour12: false }).format(now);
    const minute = new Intl.DateTimeFormat('en', { minute: '2-digit' })
        .format(now)
        .padStart(2, '0');

    return `${year}${month}${day}${hour}${minute}00`;
}

function writeToFile(filePath: string, message: string) {
    return new Promise(async (resolve, reject) => {
        const stream = fs.createWriteStream(filePath, { flags: 'a', mode: FILE_PERMISSION });
        stream.on('finish', () => {
            resolve(true);
        });
        stream.on('error', err =>
            reject(new LogException(`Can no write to file ${filePath}. Error: "${err}"`))
        );

        stream.write(`${message}${os.EOL}`);
        stream.end();
    });
}

async function writeToFileWithLock(filePath: string, message: string) {
    return new Promise(async (resolve, reject) => {
        let file: fs.promises.FileHandle | undefined;

        try {
            file = await fs.promises.open(filePath, 'a', FILE_PERMISSION);
        } catch (error) {
            reject(new LogException(`Can not open file. Error: "${error}"`));
            return;
        }

        const openFile = file;

        flock(openFile.fd, 'exnb', async err => {
            if (err) {
                openFile.close();
                reject(new LogException(`Can no lock file "${filePath}"`, 'FILE_LOCKED'));
                return;
            }

            try {
                await openFile.write(`${message}${os.EOL}`);
            } catch (error) {
                openFile.close();
                flock(openFile.fd, 'un', () => {});
                reject(new LogException(`Can not write to file "${filePath}". Error: ${error}`));
            }

            flock(openFile.fd, 'un', function(err) {
                if (err) {
                    openFile.close();
                    reject(new LogException(`Couldn't unlock file "${filePath}"`));
                    return;
                }

                openFile.close();
                resolve(true);
            });
        });
    });
}
