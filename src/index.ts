import { Builder, Browser, By, Key, until, WebDriver } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome';



async function loadMeet(driver: WebDriver): Promise<void> {
    console.log("Dinesh");
    try {
        await driver.get('https://meet.google.com/wut-idob-oin');
        await driver.wait(until.elementLocated(By.xpath('/html/body/div/c-wiz/div/div/div[35]/div[4]/div/div[2]/div[4]/div/div/div[2]/div[1]/div[1]/div[3]/div[1]/span[2]/input')), 200).sendKeys('screen-bot');
        await driver.wait(until.elementLocated(By.xpath('/html/body/div/c-wiz/div/div/div[35]/div[4]/div/div[2]/div[4]/div/div/div[2]/div[1]/div[2]/div[1]/div/div/button')), 2000).click();
        await driver.wait(until.titleIs('webdriver - Google Search'), 1000000);
    } finally {
        await driver.quit();
    }
}

async function loadDriver() {
    const options = new Options();

    options.addArguments("--disable-blink-features=AutomationControlled");
    options.addArguments("--disable-extensions");
    options.addArguments("--disable-gpu");
    options.addArguments("--disable-dev-shm-usage");
    options.addArguments("--use-fake-ui-for-media-stream");
    options.addArguments("--disable-infobars");
    options.addArguments("--disable-notifications");
    options.addArguments("--disable-geolocation");
    options.addArguments("--disable-popup-blocking");
    options.addArguments("--disable-web-security");
    options.addArguments("--disable-features=IsolateOrigins,site-per-process");
    options.addArguments("--use-fake-device-for-media-stream");
    options.addArguments("--use-fake-ui-for-media-stream");

    let driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();

    
    return driver;
}

async function startScreenShare(){};


(async function main() {
    const driver = await loadDriver();
    await loadMeet(driver);
})();