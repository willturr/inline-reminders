function notificationAPI(): typeof Notification | null {
	return typeof globalThis.Notification === "function" ? globalThis.Notification : null;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
	const api = notificationAPI();
	if (!api) return "unsupported";
	if (api.permission !== "default") return api.permission;
	try {
		return await api.requestPermission();
	} catch {
		return api.permission;
	}
}

export function showDesktopNotification(
	title: string,
	body: string,
	onClick: () => void,
	onFallback: () => void,
): Notification | null {
	let fellBack = false;
	const fallback = () => {
		if (fellBack) return;
		fellBack = true;
		onFallback();
	};
	const api = notificationAPI();
	if (!api || api.permission !== "granted") {
		fallback();
		return null;
	}

	const preview = body.replace(/\s+/g, " ").trim();
	try {
		const notification = new api(title, {
			body: preview.length > 180 ? `${preview.slice(0, 179).trimEnd()}…` : preview,
		});
		notification.onerror = fallback;
		notification.onclick = () => {
			try {
				onClick();
			} finally {
				notification.close();
			}
		};
		return notification;
	} catch {
		fallback();
		return null;
	}
}
