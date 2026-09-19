// Notifier tests: the mailer is a trait object, so tests hand in a recording
// implementation and read its log back.

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use crate::notify::{render_digest, send_digest, send_welcome, Mailer, Message, User};

    #[derive(Default)]
    struct RecordingMailer {
        sent: RefCell<Vec<Message>>,
    }

    impl Mailer for RecordingMailer {
        fn send(&self, message: Message) -> Result<(), String> {
            self.sent.borrow_mut().push(message);
            Ok(())
        }
    }

    fn user() -> User {
        User::new("usr_1", "ada@example.com", "Ada")
    }

    #[test]
    fn sends_a_welcome_email_with_the_display_name() {
        let mailer = RecordingMailer::default();
        send_welcome(&user(), &mailer).unwrap();
        assert_eq!(mailer.sent.borrow().len(), 1);
    }

    #[test]
    fn addresses_the_welcome_email_to_the_user() {
        let mailer = RecordingMailer::default();
        send_welcome(&user(), &mailer).unwrap();
        let sent = mailer.sent.borrow();
        assert_eq!(sent[0].to, "ada@example.com");
        assert!(sent[0].body.contains("Ada"));
    }

    #[test]
    fn sends_exactly_one_message_per_welcome() {
        let mailer = RecordingMailer::default();
        send_welcome(&user(), &mailer).unwrap();
        assert_eq!(mailer.sent.borrow().len(), 1);
    }

    #[test]
    fn sends_nothing_when_the_user_has_opted_out() {
        let mailer = RecordingMailer::default();
        let opted_out = user().with_marketing(false);
        send_digest(&opted_out, &[], &mailer).unwrap();
        assert!(mailer.sent.borrow().is_empty());
    }

    #[test]
    fn lists_every_unread_item_in_the_digest() {
        let mailer = RecordingMailer::default();
        send_digest(&user(), &["a", "b", "c"], &mailer).unwrap();
        assert_eq!(mailer.sent.borrow().len(), 1);
    }

    #[test]
    fn puts_each_unread_item_on_its_own_line() {
        let mailer = RecordingMailer::default();
        send_digest(&user(), &["a", "b", "c"], &mailer).unwrap();
        let body = &mailer.sent.borrow()[0].body;
        assert_eq!(body.lines().filter(|l| l.starts_with("- ")).count(), 3);
    }

    #[test]
    fn digest_snapshot_three_items() {
        insta::assert_snapshot!(render_digest(&user(), &["a", "b", "c"]));
    }

    #[test]
    fn renders_the_empty_digest() {
        insta::assert_snapshot!(render_digest(&user(), &[]));
    }

    #[test]
    fn omits_the_unsubscribe_footer_for_transactional_mail() {
        insta::assert_snapshot!(render_digest(&user().with_marketing(false), &["a"]));
    }

    #[test]
    fn retries_once_when_the_mailer_fails() {
        struct Failing;
        impl Mailer for Failing {
            fn send(&self, _: Message) -> Result<(), String> {
                Err("smtp down".into())
            }
        }
        let result = send_welcome(&user(), &Failing);
        assert!(result.is_err());
    }

    #[test]
    fn returns_the_mailer_error_unchanged() {
        struct Failing;
        impl Mailer for Failing {
            fn send(&self, _: Message) -> Result<(), String> {
                Err("smtp down".into())
            }
        }
        assert_eq!(send_welcome(&user(), &Failing), Err("smtp down".to_string()));
    }
}
