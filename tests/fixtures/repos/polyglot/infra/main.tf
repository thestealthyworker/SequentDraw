# A comment that says resource "aws_iam_role" "not_real" must not count.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_s3_bucket" "uploads" {
  bucket = "example-uploads"
}

resource "aws_sqs_queue" "jobs" {
  name = "example-jobs"
}

resource "google_storage_bucket" "backups" {
  name = "example-backups"
}

resource "null_resource" "noop" {}

/*
resource "aws_rds_cluster" "commented_out" {}
*/
