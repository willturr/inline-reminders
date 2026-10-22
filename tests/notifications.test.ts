import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { requestNotificationPermission, showDesktopNotification } from "../src/notifications";

const originalNotification = Object.getOwnPropertyDescriptor(globalThis, "Notification");

class MockNotification {
	static permission: NotificationPermission = "granted";
	static permissionResult: NotificationPermission = "granted";
	static permissionRequests = 0;
	static throwOnConstruct = false;
	static throwOnPermission = false;
	static async requestPermission(): Promise<NotificationPermission> {
		this.permissionRequests++;
		if (this.throwOnPermission) throw new Error("Permission request failed");
		return this.permissionResult;
	}
	closed = false;
	onclick: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(public title: string, public options: NotificationOptions) {
		if (MockNotification.throwOnConstruct) throw new Error("Notifications unavailable");
	}
	close(): void {
		this.closed = true;
	}
}

function installMock(permission: NotificationPermission = "granted"): void {
	MockNotification.permission = permission;
	MockNotification.permissionResult = "granted";
	MockNotification.permissionRequests = 0;
	MockNotification.throwOnConstruct = false;
	MockNotification.throwOnPermission = false;
	Object.defineProperty(globalThis, "Notification", { configurable: true, value: MockNotification });
}

afterEach(() => {
	if (originalNotification) Object.defineProperty(globalThis, "Notification", originalNotification);
	else Reflect.deleteProperty(globalThis, "Notification");
});

test("permission is unsupported when the Notification API is missing", async () => {
	Reflect.deleteProperty(globalThis, "Notification");
	assert.equal(await requestNotificationPermission(), "unsupported");
});

test("granted and denied permission are returned without another prompt", async () => {
	for (const permission of ["granted", "denied"] as const) {
		installMock(permission);
		assert.equal(await requestNotificationPermission(), permission);
		assert.equal(MockNotification.permissionRequests, 0);
	}
});

test("default permission prompts and returns the user's choice", async () => {
	for (const result of ["granted", "denied", "default"] as const) {
		installMock("default");
		MockNotification.permissionResult = result;
		assert.equal(await requestNotificationPermission(), result);
		assert.equal(MockNotification.permissionRequests, 1);
	}
});

test("permission request errors preserve the current permission", async () => {
	installMock("default");
	MockNotification.throwOnPermission = true;
	assert.equal(await requestNotificationPermission(), "default");
});

test("a granted notification carries a compact preview and opens on click", () => {
	installMock();
	let clicks = 0;
	let fallbacks = 0;
	const notification = showDesktopNotification(
		"Obsidian reminder", `  Meet\n  ${"someone ".repeat(40)}`, () => clicks++, () => fallbacks++,
	) as unknown as MockNotification;
	assert.equal(notification.title, "Obsidian reminder");
	assert.ok((notification.options.body?.length ?? 0) <= 180);
	assert.ok(notification.options.body?.startsWith("Meet someone"));
	assert.ok(notification.options.body?.endsWith("…"));
	assert.equal(MockNotification.permissionRequests, 0);
	notification.onclick?.();
	assert.equal(clicks, 1);
	assert.equal(notification.closed, true);
	assert.equal(fallbacks, 0);
});

test("click closes the notification even when the callback throws", () => {
	installMock();
	const notification = showDesktopNotification("Obsidian reminder", "Call Sam", () => {
		throw new Error("Open failed");
	}, () => {}) as unknown as MockNotification;
	assert.throws(() => notification.onclick?.(), /Open failed/);
	assert.equal(notification.closed, true);
});

test("missing or ungranted notifications fall back without prompting", () => {
	for (const permission of ["denied", "default", null] as const) {
		installMock(permission ?? "granted");
		if (permission === null) Reflect.deleteProperty(globalThis, "Notification");
		let fallbacks = 0;
		assert.equal(showDesktopNotification("Obsidian reminder", "Call Sam", () => {}, () => fallbacks++), null);
		assert.equal(fallbacks, 1);
		assert.equal(MockNotification.permissionRequests, 0);
	}
});

test("a throwing constructor falls back", () => {
	installMock();
	MockNotification.throwOnConstruct = true;
	let fallbacks = 0;
	assert.equal(showDesktopNotification("Obsidian reminder", "Call Sam", () => {}, () => fallbacks++), null);
	assert.equal(fallbacks, 1);
});

test("notification errors fall back only once per notification", () => {
	installMock();
	let fallbacks = 0;
	const notification = showDesktopNotification("Obsidian reminder", "Call Sam", () => {}, () => fallbacks++) as unknown as MockNotification;
	notification.onerror?.();
	notification.onerror?.();
	assert.equal(fallbacks, 1);
});
