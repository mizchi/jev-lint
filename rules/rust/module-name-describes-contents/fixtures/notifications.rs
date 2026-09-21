// Corpus file.

pub struct Notification {
    pub subject: String,
    pub body: String,
}

pub fn render_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in vars {
        out = out.replace(&format!("{{{{{key}}}}}"), value);
    }
    out
}

pub fn send_email(to: &str, note: &Notification) -> bool {
    !to.is_empty() && !note.subject.is_empty()
}

pub fn send_sms(to: &str, note: &Notification) -> bool {
    !to.is_empty() && note.body.len() <= 160
}

pub fn send_push(device_token: &str, note: &Notification) -> bool {
    !device_token.is_empty() && !note.body.is_empty()
}
