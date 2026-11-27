use tauri::Url;

pub(crate) fn is_app_url(url: &Url, app_url: &Url) -> bool {
    url.origin() == app_url.origin() && url.username().is_empty() && url.password().is_none()
}

pub(crate) fn is_auth_url(url: &Url, app_url: &Url) -> bool {
    is_app_url(url, app_url) && (url.path() == "/auth" || url.path().starts_with("/auth/"))
}

pub(crate) fn can_open_external(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http" | "mailto")
        && url.username().is_empty()
        && url.password().is_none()
}

pub(crate) fn open_external(url: &Url) {
    if can_open_external(url) {
        let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authentication_stays_on_the_exact_app_origin() {
        let app = Url::parse("https://tongkk.com/mini").unwrap();
        for value in ["https://tongkk.com/auth", "https://tongkk.com/auth/reset-password"] {
            assert!(is_auth_url(&Url::parse(value).unwrap(), &app));
        }
        for value in [
            "https://attacker.test/auth", "https://tongkk.com.attacker.test/auth",
            "http://tongkk.com/auth", "https://tongkk.com:444/auth",
            "https://attacker@tongkk.com/auth", "https://tongkk.com/authorize",
        ] {
            assert!(!is_auth_url(&Url::parse(value).unwrap(), &app));
        }
    }

    #[test]
    fn external_links_cannot_launch_local_files_or_custom_protocols() {
        for value in ["https://example.test/file.pdf", "mailto:help@example.test", "http://localhost:5173/"] {
            assert!(can_open_external(&Url::parse(value).unwrap()));
        }
        for value in ["file:///Applications/Calculator.app", "javascript:alert(1)", "data:text/html,test", "custom-app://launch", "https://user:password@example.test/"] {
            assert!(!can_open_external(&Url::parse(value).unwrap()));
        }
    }

    #[test]
    fn development_origin_does_not_trust_other_local_servers() {
        let app = Url::parse("http://localhost:5173/mini").unwrap();
        assert!(is_app_url(&Url::parse("http://localhost:5173/auth").unwrap(), &app));
        assert!(!is_app_url(&Url::parse("http://localhost:8000/auth").unwrap(), &app));
        assert!(!is_app_url(&Url::parse("https://tongkk.com/auth").unwrap(), &app));
    }
}
