import * as path from 'path';
import * as Mocha from 'mocha';
import * as fs from 'fs';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, '..');
    const suiteRoot = path.resolve(testsRoot, 'suite');

    return new Promise((resolve, reject) => {
        try {
            const files = fs.readdirSync(suiteRoot);
            for (const file of files) {
                if (file.endsWith('.test.js')) {
                    mocha.addFile(path.resolve(suiteRoot, file));
                }
            }

            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (error) {
            console.error(error);
            reject(error);
        }
    });
}
